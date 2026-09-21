// lib/recipes/recompute.ts
//
// Orchestration around computeRecipeCost:
//   • recomputeAfterIngest — a batch of purchase_lines just landed; find
//     the canonical ingredients those product names feed, find every
//     recipe that uses one of them, recompute + persist, then republish
//     the affected menu_dish_costing rows.
//   • recomputeRecipes     — compute + persist a list of recipe ids.
//   • refreshMenuMargin    — copy recipes.cost_* onto menu_dish_costing
//     (the "publish" step the /studio/money/menu-margin page reads).
//
// Matching mirrors computeCost exactly, so "affected" means the same
// thing the pricer means:
//   product → canonical : purchase_lines.raw_product_text contains an alias
//                         of that canonical (computeCost uses ilike %alias%)
//   recipe  → canonical : normalised ingredient name == alias / canonical,
//                         or its singular form does.
// Over-matching is harmless (a recompute that changes nothing); missing a
// recipe is not — so we err wide.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeRecipeCost,
  persistRecipeCost,
  normalizeName,
  singularize,
  ENTITY_ID_FOR_PL_CODE,
  type Confidence,
  type CostResult,
} from "@/lib/recipes/computeCost";

export type AliasIndex = {
  byKey: Map<string, string>;               // normalised alias/canonical → canonical
  aliasesByCanonical: Map<string, string[]>; // canonical → normalised patterns
};

export async function loadAliasIndex(sb: SupabaseClient, entityId: string): Promise<AliasIndex> {
  const byKey = new Map<string, string>();
  const aliasesByCanonical = new Map<string, string[]>();
  const { data, error } = await sb
    .from("ingredient_aliases")
    .select("alias, canonical_name")
    .eq("entity_id", entityId)
    .limit(10000);
  if (error) throw new Error("ingredient_aliases read failed: " + error.message);
  const add = (canonical: string, key: string) => {
    if (!key) return;
    if (!byKey.has(key)) byKey.set(key, canonical);
    const list = aliasesByCanonical.get(canonical) || [];
    if (!list.includes(key)) list.push(key);
    aliasesByCanonical.set(canonical, list);
  };
  for (const a of (data as any[]) || []) {
    const canonical = String(a.canonical_name || "").trim();
    if (!canonical) continue;
    const k = normalizeName(a.alias);
    add(canonical, k);
    const sing = singularize(k);
    if (sing !== k && !byKey.has(sing)) byKey.set(sing, canonical);
    add(canonical, normalizeName(canonical));
  }
  return { byKey, aliasesByCanonical };
}

export function resolveCanonical(idx: AliasIndex, ingredientName: string | null | undefined): string | null {
  const k = normalizeName(ingredientName);
  if (!k) return null;
  return idx.byKey.get(k) ?? idx.byKey.get(singularize(k)) ?? null;
}

// Which canonicals does a set of raw purchase-line product names feed?
export function canonicalsForProducts(idx: AliasIndex, rawTexts: Array<string | null | undefined>): Set<string> {
  const out = new Set<string>();
  const norms = [...new Set(rawTexts.map((t) => normalizeName(t)).filter(Boolean))];
  if (norms.length === 0) return out;
  for (const [canonical, patterns] of idx.aliasesByCanonical) {
    if (patterns.some((p) => norms.some((n) => n === p || n.includes(p)))) out.add(canonical);
  }
  return out;
}

// Active recipes of an entity whose ingredient list touches any canonical.
export async function recipesUsingCanonicals(
  sb: SupabaseClient,
  entityId: string,
  idx: AliasIndex,
  canonicals: Set<string>
): Promise<string[]> {
  if (canonicals.size === 0) return [];
  const { data: recipes, error } = await sb
    .from("recipes")
    .select("id")
    .eq("entity_id", entityId)
    .eq("is_active", true);
  if (error) throw new Error("recipes read failed: " + error.message);
  const ids = ((recipes as any[]) || []).map((r) => r.id as string);
  const hit = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const { data: ings, error: iErr } = await sb
      .from("recipe_ingredients")
      .select("recipe_id, ingredient_name, name")
      .in("recipe_id", chunk);
    if (iErr) throw new Error("recipe_ingredients read failed: " + iErr.message);
    for (const ing of (ings as any[]) || []) {
      const c = resolveCanonical(idx, ing.ingredient_name ?? ing.name);
      if (c && canonicals.has(c)) hit.add(ing.recipe_id);
    }
  }
  return [...hit];
}

export type RecomputeSummary = {
  processed: number;
  tallies: Record<Confidence, number>;
  failed: Array<{ id: string; error: string }>;
  results: Map<string, CostResult>;
};

export async function recomputeRecipes(sb: SupabaseClient, recipeIds: string[]): Promise<RecomputeSummary> {
  const tallies: Record<Confidence, number> = { high: 0, medium: 0, low: 0, missing: 0 };
  const failed: Array<{ id: string; error: string }> = [];
  const results = new Map<string, CostResult>();
  let processed = 0;
  for (const id of recipeIds) {
    try {
      const res = await computeRecipeCost(sb, id);
      await persistRecipeCost(sb, res);
      results.set(id, res);
      tallies[res.confidence]++;
      processed++;
    } catch (e: any) {
      failed.push({ id, error: String(e?.message || e) });
    }
  }
  return { processed, tallies, failed, results };
}

function missingComponentsFrom(res: CostResult): Array<{ ingredient?: string; status?: string; note: string }> {
  if (res.ingredient_count === 0) return [{ note: "recipe has no ingredients yet" }];
  return res.breakdown
    .filter((b) => b.status !== "priced")
    .map((b) => ({
      ingredient: b.ingredient_name,
      status: b.status,
      note: `${b.ingredient_name}: ${b.status === "no_alias" ? "not linked to a purchase" : b.note || "no price"}`,
    }));
}

// Publish recipes.cost_* onto menu_dish_costing. recipeIds limits the
// rows touched; omitted = every matched row. `results` (fresh
// CostResults) lets us also rewrite missing_components with the
// ingredient-level truth instead of the parser's guess.
export async function refreshMenuMargin(
  sb: SupabaseClient,
  opts: { recipeIds?: string[]; results?: Map<string, CostResult> } = {}
): Promise<{ rows: number; updated: number; error?: string }> {
  let q = sb
    .from("menu_dish_costing")
    .select("id, sell_price_eur, matched_recipe_id")
    .not("matched_recipe_id", "is", null);
  if (opts.recipeIds) {
    if (opts.recipeIds.length === 0) return { rows: 0, updated: 0 };
    q = q.in("matched_recipe_id", opts.recipeIds);
  }
  const { data: rows, error } = await q;
  if (error) return { rows: 0, updated: 0, error: error.message };

  const ids = [...new Set(((rows as any[]) || []).map((r) => r.matched_recipe_id as string))];
  if (ids.length === 0) return { rows: 0, updated: 0 };

  const { data: recipes, error: rErr } = await sb
    .from("recipes")
    .select("id, cost_per_portion_eur, cost_confidence")
    .in("id", ids);
  if (rErr) return { rows: (rows || []).length, updated: 0, error: rErr.message };
  const byId = new Map<string, { cost: number | null; conf: string | null }>();
  for (const r of (recipes as any[]) || []) {
    byId.set(r.id, { cost: r.cost_per_portion_eur == null ? null : Number(r.cost_per_portion_eur), conf: r.cost_confidence ?? null });
  }

  let updated = 0;
  for (const row of (rows as any[]) || []) {
    const r = byId.get(row.matched_recipe_id);
    if (!r) continue;
    // menu_dish_costing only allows high|medium|low — 'missing' publishes
    // as 'low' with a null cost. Never a €0 lie.
    const rawConf = r.conf || "low";
    const conf = rawConf === "missing" ? "low" : rawConf;
    const cost = rawConf === "missing" ? null : r.cost;
    const sell = row.sell_price_eur == null ? null : Number(row.sell_price_eur);
    const marginEur = cost != null && sell != null ? sell - cost : null;
    const marginPct = marginEur != null && sell && sell > 0 ? (marginEur / sell) * 100 : null;

    const patch: Record<string, any> = {
      cost_per_portion_eur: cost,
      gross_margin_eur: marginEur,
      gross_margin_pct: marginPct,
      cost_confidence: conf,
      computed_at: new Date().toISOString(),
    };
    const fresh = opts.results?.get(row.matched_recipe_id);
    if (fresh) {
      patch.missing_components = missingComponentsFrom(fresh);
      patch.component_count = fresh.ingredient_count;
    }
    // .select() so an RLS-blocked update shows up as 0 rows, not success.
    const { data: upd, error: uErr } = await sb.from("menu_dish_costing").update(patch).eq("id", row.id).select("id");
    if (!uErr && upd && upd.length > 0) updated++;
  }
  return { rows: (rows || []).length, updated };
}

export type IngestRecompute = {
  entity_code: string;
  canonicals: string[];
  recipe_ids: string[];
  processed: number;
  tallies: Record<Confidence, number>;
  failed: Array<{ id: string; error: string }>;
  menu_rows_updated: number;
  skipped?: string;
};

// Call right after purchase_lines rows are written.
export async function recomputeAfterIngest(
  sb: SupabaseClient,
  entityCode: string | null | undefined,
  rawProductTexts: Array<string | null | undefined>
): Promise<IngestRecompute> {
  const empty: IngestRecompute = {
    entity_code: entityCode || "",
    canonicals: [],
    recipe_ids: [],
    processed: 0,
    tallies: { high: 0, medium: 0, low: 0, missing: 0 },
    failed: [],
    menu_rows_updated: 0,
  };
  const entityId = entityCode ? ENTITY_ID_FOR_PL_CODE[entityCode] : undefined;
  if (!entityId) return { ...empty, skipped: "entity_code not mapped" };

  const idx = await loadAliasIndex(sb, entityId);
  const canonicals = canonicalsForProducts(idx, rawProductTexts);
  if (canonicals.size === 0) return { ...empty, skipped: "no product matched an alias" };

  const recipeIds = await recipesUsingCanonicals(sb, entityId, idx, canonicals);
  if (recipeIds.length === 0) return { ...empty, canonicals: [...canonicals], skipped: "no recipe uses these ingredients" };

  const sum = await recomputeRecipes(sb, recipeIds);
  const menu = await refreshMenuMargin(sb, { recipeIds, results: sum.results });
  return {
    entity_code: entityCode!,
    canonicals: [...canonicals],
    recipe_ids: recipeIds,
    processed: sum.processed,
    tallies: sum.tallies,
    failed: sum.failed,
    menu_rows_updated: menu.updated,
  };
}
