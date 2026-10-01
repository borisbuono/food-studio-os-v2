// lib/menu/provisional.ts — provisional ingredient prices for names the
// invoices have never seen (menu-first loop, slice 2).
//
// The costing runs in Postgres (fn_cost_recipe). A line it could not price is
// left with cost_note = 'no price for this ingredient'. This module collects
// those names per venue, asks Haiku for a Spanish wholesale norm (ex-VAT,
// €/kg | €/l | €/pcs) and writes ingredient_prices rows with
// source='provisional', needs_confirm=true. The page shows them with an
// "estimate" badge and a one-tap confirm; nothing here is ever silent
// (Foundation §6.1). Model and key are configuration, not features (§1.4).

import type { SupabaseClient } from "@supabase/supabase-js";

const MODEL = process.env.FS_PRICE_ESTIMATE_MODEL || "claude-haiku-4-5-20251001";

export type Estimate = { name: string; unit: "kg" | "l" | "pcs"; price_eur: number; unit_weight_kg?: number | null; aliases?: string[]; note?: string };

export async function unpricedNames(sb: SupabaseClient, entityId: string, limit = 60): Promise<string[]> {
  // lines of recipes bound to this venue's current menu (and their sub-recipes) that the pricer could not resolve
  const { data: rest } = await sb.from("restaurants").select("id").eq("entity_id", entityId).limit(1).maybeSingle();
  if (!rest) return [];
  const { data: items } = await sb.from("menu_items").select("recipe_id").eq("restaurant_id", rest.id).eq("is_active", true).not("recipe_id", "is", null);
  const rids = [...new Set((items || []).map((i: any) => i.recipe_id as string))];
  if (!rids.length) return [];
  const { data: subs } = await sb.from("recipe_ingredients").select("sub_recipe_id, linked_recipe_id").in("recipe_id", rids);
  for (const s of (subs || []) as any[]) { if (s.sub_recipe_id) rids.push(s.sub_recipe_id); if (s.linked_recipe_id) rids.push(s.linked_recipe_id); }
  const { data: lines } = await sb.from("recipe_ingredients").select("ingredient_name, name").in("recipe_id", [...new Set(rids)]).eq("cost_note", "no price for this ingredient").limit(500);
  const names = new Set<string>();
  for (const l of (lines || []) as any[]) { const n = String(l.ingredient_name || l.name || "").trim(); if (n && n.length <= 60) names.add(n); }
  if (names.size >= limit) return [...names].slice(0, limit);
  // then the rest of the venue's library, most-used names first — the nightly
  // run works through it a batch at a time ("the rest nightly")
  const { data: own } = await sb.from("recipes").select("id").eq("entity_id", entityId).eq("is_active", true).limit(2000);
  const ownIds = (own || []).map((r: any) => r.id as string);
  if (ownIds.length) {
    const freq = new Map<string, number>();
    for (let i = 0; i < ownIds.length; i += 300) {
      const { data: more } = await sb.from("recipe_ingredients").select("ingredient_name, name").in("recipe_id", ownIds.slice(i, i + 300)).eq("cost_note", "no price for this ingredient").limit(2000);
      for (const l of (more || []) as any[]) { const n = String(l.ingredient_name || l.name || "").trim(); if (n && n.length <= 60) freq.set(n, (freq.get(n) || 0) + 1); }
    }
    for (const [n] of [...freq.entries()].sort((a, b) => b[1] - a[1])) { if (names.size >= limit) break; names.add(n); }
  }
  return [...names].slice(0, limit);
}

export async function estimatePrices(names: string[]): Promise<Estimate[]> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || !names.length) return [];
  const prompt = `You price ingredients for a restaurant in Ibiza, Spain. For each ingredient name below give the typical 2026 WHOLESALE price a restaurant pays, ex-VAT, in euros, per unit: "kg" for solids, "l" for liquids, "pcs" only for things bought by the piece (eggs, oysters, a croissant). Names may be Spanish or English and may be kitchen preparations (e.g. "saffron béchamel", "prawn emulsion") — price those as the finished prep per kg from their typical ingredients. Water is 0. If a name is a sub-recipe or a non-ingredient instruction, still return a conservative price.
Return ONLY a JSON array, one object per name, in the same order: {"name": <exact input>, "unit": "kg"|"l"|"pcs", "price_eur": <number>, "unit_weight_kg": <kg per piece, only when unit is pcs, else null>, "aliases": [<up to 3 other spellings a kitchen uses, es/en>], "note": "<≤10 words on the basis>"}.
Names:
${names.map((n) => "- " + n).join("\n")}`;
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 4000, temperature: 0, messages: [{ role: "user", content: prompt }] }),
  });
  if (!r.ok) throw new Error(`anthropic ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  const text: string = (j?.content || []).map((c: any) => c?.text || "").join("");
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) return [];
  let arr: any[] = [];
  try { arr = JSON.parse(m[0]); } catch { return []; }
  const out: Estimate[] = [];
  for (const e of arr) {
    const unit = e?.unit === "l" || e?.unit === "pcs" ? e.unit : "kg";
    const price = Number(e?.price_eur);
    if (!e?.name || !Number.isFinite(price) || price < 0 || price > 10000) continue;
    out.push({ name: String(e.name), unit, price_eur: Math.round(price * 100) / 100, unit_weight_kg: e?.unit_weight_kg == null ? null : Number(e.unit_weight_kg) || null, aliases: Array.isArray(e?.aliases) ? e.aliases.slice(0, 3).map(String) : [], note: e?.note ? String(e.note).slice(0, 80) : undefined });
  }
  return out;
}

export async function writeProvisional(sb: SupabaseClient, entityId: string, estimates: Estimate[]): Promise<number> {
  let n = 0;
  for (const e of estimates) {
    const row = {
      entity_id: entityId, canonical_name: e.name, aliases: e.aliases || [], unit: e.unit, price_eur: e.price_eur,
      unit_weight_kg: e.unit_weight_kg ?? null, source: "provisional", needs_confirm: true,
      estimated_by: `${MODEL} (nightly recost)`, note: `estimate — ${e.note || "Spanish wholesale norm"}; confirm or correct`,
    };
    const { error } = await sb.from("ingredient_prices").upsert(row, { onConflict: "entity_id,name_norm", ignoreDuplicates: true });
    if (!error) n++;
  }
  return n;
}

// The whole step for one venue: find what the pricer could not price, estimate, write, report.
export async function fillProvisional(sb: SupabaseClient, entityId: string): Promise<{ asked: number; written: number; error?: string }> {
  try {
    const names = await unpricedNames(sb, entityId);
    if (!names.length) return { asked: 0, written: 0 };
    const est = await estimatePrices(names);
    const written = await writeProvisional(sb, entityId, est);
    return { asked: names.length, written };
  } catch (e: any) {
    return { asked: 0, written: 0, error: String(e?.message || e) };
  }
}
