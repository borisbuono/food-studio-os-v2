// lib/recipes/computeCost.ts
//
// Weighted-average cost per portion for a recipe, sourced from
// `purchase_lines` (captured invoices), not Holded. See memory notes
// `holded_no_ingredient_prices`, `catalogue_has_no_unit_contract`,
// `bm_food_draft_lag_explains_month_not_year`.
//
// Match chain per recipe_ingredient:
//   ingredient_name → normalize → ingredient_aliases.alias (per entity)
//   → canonical_name → weighted-avg unit price from purchase_lines
//     for that entity_code in the last 30 days.
//
// Weighted average = SUM(line_total_eur) / SUM(qty × unit_conversion)
// over rows matching any alias that resolves to the same canonical name.
//
// Confidence (as briefed):
//   high    = all ingredients priced from purchase_lines ≤30 days old
//   medium  = >70% priced, some >30d old
//   low     = <70% priced
//   missing = <30% priced — DO NOT PUBLISH A LIE

import type { SupabaseClient } from "@supabase/supabase-js";
import { E_BM, E_TALLER, E_HOLDINGS, E_UTOPIA } from "@/lib/entities";

// entity_id (UUID) → entity_code used in purchase_lines
export const ENTITY_CODE_FOR_PL: Record<string, string> = {
  [E_TALLER]:   "IFL",
  [E_BM]:       "BM",
  [E_HOLDINGS]: "BBH",
  [E_UTOPIA]:   "UTOPIA",
};

// Reverse map: purchase_lines.entity_code → entity_id.
export const ENTITY_ID_FOR_PL_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(ENTITY_CODE_FOR_PL).map(([id, code]) => [code, id])
);

export type Confidence = "high" | "medium" | "low" | "missing";

export type IngredientBreakdown = {
  ingredient_name: string;
  quantity: number | null;
  unit: string | null;
  canonical_name: string | null;
  unit_price_eur: number | null;
  unit_conversion: number;
  line_cost_eur: number | null;
  price_sample_count: number;
  price_stale: boolean; // any purchase-line contributor >30d? (we already filter, but keep for future)
  status: "priced" | "unpriced" | "no_alias";
  note?: string;
};

export type CostResult = {
  recipe_id: string;
  cost_per_portion_eur: number | null;
  confidence: Confidence;
  yield_qty: number;             // effective portions/servings the SUM covers
  total_recipe_cost_eur: number; // sum of all ingredient line_cost_eur
  ingredient_count: number;
  priced_count: number;
  missing_ingredients: string[];  // ingredient_name strings we couldn't price
  breakdown: IngredientBreakdown[];
};

export function normalizeName(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Pragmatic Spanish/English plural stripper — 'tomates' -> 'tomate', 'peppers' -> 'pepper'
export function singularize(s: string): string {
  if (s.length <= 3) return s;
  if (s.endsWith("ies")) return s.slice(0, -3) + "y";
  if (s.endsWith("es"))  return s.slice(0, -2);
  if (s.endsWith("s"))   return s.slice(0, -1);
  return s;
}

// Compute per-recipe cost. Requires: recipes.entity_id, recipe_ingredients,
// ingredient_aliases (per entity_id) and purchase_lines with entity_code.
export async function computeRecipeCost(
  sb: SupabaseClient,
  recipeId: string
): Promise<CostResult> {
  const { data: recipe, error: rErr } = await sb
    .from("recipes")
    .select("id, entity_id, yield_qty, servings, portion_size, cost_per_portion")
    .eq("id", recipeId)
    .maybeSingle();
  if (rErr) throw new Error("recipes read failed: " + rErr.message);
  if (!recipe) throw new Error("recipe not found");

  const entityId: string | null = (recipe as any).entity_id ?? null;
  const entityCode = entityId ? ENTITY_CODE_FOR_PL[entityId] : null;

  const { data: rawIngs, error: iErr } = await sb
    .from("recipe_ingredients")
    .select("id, ingredient_name, name, quantity, unit")
    .eq("recipe_id", recipeId);
  if (iErr) throw new Error("recipe_ingredients read failed: " + iErr.message);

  const ings = (rawIngs || []).map((r: any) => ({
    id: r.id as string,
    ingredient_name: (r.ingredient_name ?? r.name ?? "").toString(),
    quantity: r.quantity == null ? null : Number(r.quantity),
    unit: r.unit ?? null,
  }));

  // yield_qty preference: recipes.yield_qty, else servings, else 1.
  const y = Number((recipe as any).yield_qty);
  const s = Number((recipe as any).servings);
  const yieldQty = Number.isFinite(y) && y > 0
    ? y
    : Number.isFinite(s) && s > 0 ? s : 1;

  // Load ingredient_aliases for this entity ONCE and build a
  // normalized-alias -> { canonical, conversion, unit } map.
  const aliases: Record<string, { canonical: string; conversion: number; unit: string | null }> = {};
  if (entityId) {
    const { data: aliasRows } = await sb
      .from("ingredient_aliases")
      .select("alias, canonical_name, unit_conversion, unit")
      .eq("entity_id", entityId);
    for (const a of (aliasRows as any[]) || []) {
      const key = normalizeName(a.alias);
      if (!key) continue;
      aliases[key] = {
        canonical: a.canonical_name,
        conversion: Number(a.unit_conversion) || 1,
        unit: a.unit ?? null,
      };
      // Also index the singularised form so 'tomates' → 'Tomate' resolves.
      const sing = singularize(key);
      if (sing !== key && !aliases[sing]) {
        aliases[sing] = {
          canonical: a.canonical_name,
          conversion: Number(a.unit_conversion) || 1,
          unit: a.unit ?? null,
        };
      }
    }
  }

  // Also index by canonical -> {conversion: 1, unit} so a recipe that
  // already uses the canonical spelling ("Tomate") resolves without a
  // dedicated alias row.
  if (entityId) {
    const canonicalUnits: Record<string, { unit: string | null; conversion: number }> = {};
    for (const rec of Object.values(aliases)) {
      const k = normalizeName(rec.canonical);
      if (!canonicalUnits[k]) canonicalUnits[k] = { unit: rec.unit, conversion: 1 };
    }
    for (const [k, v] of Object.entries(canonicalUnits)) {
      if (!aliases[k]) {
        aliases[k] = { canonical: findCanonical(aliases, k) || k, conversion: 1, unit: v.unit };
      }
    }
  }

  // For each canonical the recipe needs, fetch the weighted-average unit
  // price from purchase_lines (last 30d, this entity_code).
  const canonicalsWanted = new Set<string>();
  const ingCanonical: (string | null)[] = ings.map((i) => {
    const k = normalizeName(i.ingredient_name);
    const hit = aliases[k] || aliases[singularize(k)];
    if (hit) {
      canonicalsWanted.add(hit.canonical);
      return hit.canonical;
    }
    return null;
  });

  // Weighted average price per canonical name.
  const priceMap: Record<string, { unitPrice: number; sampleCount: number; allStale: boolean; anyStale: boolean }> = {};
  if (entityCode && canonicalsWanted.size > 0) {
    // For each canonical name, gather the aliases that resolve to it, then
    // ilike-match purchase_lines.raw_product_text against those aliases.
    // We fetch aliases-by-canonical to build the WHERE list.
    const aliasByCanonical: Record<string, string[]> = {};
    for (const [aliasKey, meta] of Object.entries(aliases)) {
      if (!canonicalsWanted.has(meta.canonical)) continue;
      const list = aliasByCanonical[meta.canonical] || (aliasByCanonical[meta.canonical] = []);
      list.push(aliasKey);
    }

    // Window: prefer last 30 days (fresh), fall back to last 180 days so
    // that seasonal shifts and stalled purchase capture (last row on file
    // 2026-08-15 as of 2026-09-20 per the DB check) don't produce a wall
    // of "missing" rows. Contributors older than 30d flip the recipe to
    // 'medium' confidence.
    const now = Date.now();
    const since = new Date(now - 180 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const freshCutoffMs = now - 30 * 24 * 3600 * 1000;

    for (const canonical of canonicalsWanted) {
      const aliasStrings = aliasByCanonical[canonical] || [];
      if (aliasStrings.length === 0) continue;

      // Build an OR of ilike patterns. Cap at 30 patterns to keep the URL short.
      // Also match on the canonical spelling itself.
      const patternPool = new Set<string>(aliasStrings);
      patternPool.add(normalizeName(canonical));
      const patterns = [...patternPool].slice(0, 30).map((a) =>
        `raw_product_text.ilike.%${a.replace(/[,()%_]/g, " ")}%`
      );

      const { data: plRows } = await sb
        .from("purchase_lines")
        .select("qty, unit, line_total_eur, doc_date, raw_product_text")
        .eq("entity_code", entityCode)
        .gte("doc_date", since)
        .or(patterns.join(","))
        .order("doc_date", { ascending: false })
        .limit(500);

      let totalCost = 0;
      let totalQty = 0;
      let n = 0;
      let anyStale = false;
      let allStale = true;
      for (const row of (plRows as any[]) || []) {
        const qty = Number(row.qty);
        const total = Number(row.line_total_eur);
        if (!Number.isFinite(qty) || qty <= 0) continue;
        if (!Number.isFinite(total) || total <= 0) continue;
        // Look up the alias record that matched (best-effort by name)
        // to apply unit_conversion. Fallback conversion=1.
        const rawKey = normalizeName(String(row.raw_product_text || ""));
        const conv = aliases[rawKey]?.conversion || 1;
        totalQty += qty * conv;
        totalCost += total;
        n++;
        const docTime = row.doc_date ? Date.parse(row.doc_date as string) : 0;
        if (docTime < freshCutoffMs) anyStale = true;
        else allStale = false;
      }
      if (totalQty > 0 && n > 0) {
        priceMap[canonical] = {
          unitPrice: totalCost / totalQty,
          sampleCount: n,
          allStale,
          anyStale,
        };
      }
    }
  }

  // Assemble breakdown + totals
  const breakdown: IngredientBreakdown[] = ings.map((i, idx) => {
    const canonical = ingCanonical[idx];
    const priced = canonical ? priceMap[canonical] : undefined;
    // Recipe quantities are expressed in the CANONICAL unit. unit_conversion
    // belongs to the purchase side (pack → canonical) and is already folded
    // into unitPrice above; applying it again here double-counted whenever a
    // recipe line happened to be spelled like a pack-size alias.
    const conv = 1;
    const qty = i.quantity == null ? null : Number(i.quantity);

    if (!canonical) {
      return {
        ingredient_name: i.ingredient_name,
        quantity: qty,
        unit: i.unit,
        canonical_name: null,
        unit_price_eur: null,
        unit_conversion: conv,
        line_cost_eur: null,
        price_sample_count: 0,
        price_stale: false,
        status: "no_alias",
        note: "no alias → link it in /kitchen/ingredients",
      };
    }
    if (!priced) {
      return {
        ingredient_name: i.ingredient_name,
        quantity: qty,
        unit: i.unit,
        canonical_name: canonical,
        unit_price_eur: null,
        unit_conversion: conv,
        line_cost_eur: null,
        price_sample_count: 0,
        price_stale: true,
        status: "unpriced",
        note: "no purchase_lines in last 30d",
      };
    }
    const cost = qty == null ? null : qty * conv * priced.unitPrice;
    return {
      ingredient_name: i.ingredient_name,
      quantity: qty,
      unit: i.unit,
      canonical_name: canonical,
      unit_price_eur: priced.unitPrice,
      unit_conversion: conv,
      line_cost_eur: cost,
      price_sample_count: priced.sampleCount,
      price_stale: priced.allStale,
      status: cost == null ? "unpriced" : "priced",
      note: cost == null
        ? "quantity missing on recipe row"
        : priced.allStale
          ? "all samples >30d old"
          : priced.anyStale
            ? "some samples >30d"
            : undefined,
    };
  });

  const priced = breakdown.filter((b) => b.status === "priced");
  const totalRecipeCost = priced.reduce((sum, b) => sum + (b.line_cost_eur || 0), 0);
  const costPerPortion = yieldQty > 0 ? totalRecipeCost / yieldQty : null;
  const pricedFraction = ings.length === 0 ? 0 : priced.length / ings.length;
  const anyStale = priced.some((b) => b.price_stale);

  let confidence: Confidence = "missing";
  if (ings.length === 0) {
    confidence = "missing";
  } else if (pricedFraction >= 1 && !anyStale) {
    confidence = "high";
  } else if (pricedFraction > 0.7) {
    confidence = "medium";
  } else if (pricedFraction >= 0.3) {
    confidence = "low";
  } else {
    confidence = "missing";
  }

  const missing = breakdown.filter((b) => b.status !== "priced").map((b) => b.ingredient_name);

  return {
    recipe_id: recipeId,
    cost_per_portion_eur: confidence === "missing" ? null : (costPerPortion ?? null),
    confidence,
    yield_qty: yieldQty,
    total_recipe_cost_eur: Number(totalRecipeCost.toFixed(4)),
    ingredient_count: ings.length,
    priced_count: priced.length,
    missing_ingredients: missing,
    breakdown,
  };
}

function findCanonical(aliases: Record<string, { canonical: string }>, k: string): string | null {
  const hit = aliases[k];
  return hit ? hit.canonical : null;
}

// Convenience — persist the result onto recipes.cost_per_portion_eur so
// the /studio/money/menu-margin page can read it without recomputing.
export async function persistRecipeCost(
  sb: SupabaseClient,
  res: CostResult
): Promise<void> {
  await sb
    .from("recipes")
    .update({
      cost_per_portion_eur: res.cost_per_portion_eur,
      cost_computed_at: new Date().toISOString(),
      cost_confidence: res.confidence,
    })
    .eq("id", res.recipe_id);
}
