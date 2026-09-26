// lib/chef/foodCost.ts — Chef v3 slice C: the food-cost capability.
//
// "what's my food cost on the lamb" / "cuánto me cuesta el brownie" /
// "margin on the sea bass". Resolves the dish by fuzzy name INSIDE the entity
// scope (menu_items via the venue's restaurant, recipes via entity_id, then
// the shared library like readRecipes), costs it with the existing maths in
// lib/recipes/calculation.ts (the logic behind the orphaned
// GET /api/recipes/food-cost) and returns ONE card: cost, price, margin %,
// top 3 ingredients by cost — plus a one-sentence say-line.
//
// Honesty rule (brief §7): never invent a number. If the recipe has no
// computed cost (BM/Taller lines are still 0 today) the card says so and
// shows what IS known (price, how many lines are priced). Unknown dish →
// clarify card with the 3 nearest names.
//
// Server only. Pure reader: writes nothing but chef_turns (done by the router).

import type { SupabaseClient } from "@supabase/supabase-js";
import { foodCostPercent, overTargetAlert, round1, round2 } from "@/lib/recipes/calculation";
import type { ChefCard, ChefLang } from "@/lib/chef/types";

export type FoodCostScope = { entity_id: string; entity_name: string; restaurant_id: string | null; house: string | null };

export type FoodCostResult = {
  found: boolean;
  card: ChefCard;
  say: string;
  // resolved facts (for the log / tests)
  dish?: { id: string; name: string; source: "menu_item" | "recipe" };
  cost_per_serving?: number | null;
  price?: number | null;
  food_cost_percent?: number | null;
  target?: number;
  top?: Array<{ name: string; cost: number }>;
  nearest?: string[];
};

type Candidate = { id: string; name: string; source: "menu_item" | "recipe"; recipe_id: string | null; price: number | null; cost: number | null; target: number | null };

const S = {
  es: {
    title: (n: string) => "Food cost · " + n,
    cost: (c: number) => "Coste por ración: " + eur(c),
    price: (p: number) => "Precio carta: " + eur(p),
    pct: (f: number, t: number) => "Food cost: " + f.toFixed(1) + " % (objetivo " + t.toFixed(0) + " %)",
    margin: (m: number) => "Margen bruto: " + eur(m),
    no_cost: (priced: number, total: number) => total ? "Coste sin calcular — " + priced + " de " + total + " ingredientes con precio" : "Coste sin calcular — sin escandallo",
    no_price: "Sin precio de carta",
    top: (xs: Array<{ name: string; cost: number }>) => "Top: " + xs.map((x) => x.name + " " + eur(x.cost)).join(" · "),
    say_ok: (n: string, f: number, t: number, over: boolean) => n + " va al " + f.toFixed(1) + " por ciento de food cost, objetivo " + t.toFixed(0) + (over ? ". Por encima, merece revisión." : ". En rango."),
    say_cost_only: (n: string, c: number) => n + " cuesta " + eur(c) + " la ración; falta el precio de carta.",
    say_price_only: (n: string, p: number) => n + " se vende a " + eur(p) + " pero el escandallo aún no tiene coste.",
    say_nothing: (n: string) => "Tengo " + n + " pero sin coste ni precio todavía.",
    unknown: "No encuentro ese plato",
    unknown_say: (q: string) => "No encuentro " + q + ". ¿Cuál de estos?",
    none_say: (q: string) => "No encuentro ningún plato parecido a " + q + " en esta casa.",
    open: "Abrir",
  },
  en: {
    title: (n: string) => "Food cost · " + n,
    cost: (c: number) => "Cost per serving: " + eur(c),
    price: (p: number) => "Menu price: " + eur(p),
    pct: (f: number, t: number) => "Food cost: " + f.toFixed(1) + "% (target " + t.toFixed(0) + "%)",
    margin: (m: number) => "Gross margin: " + eur(m),
    no_cost: (priced: number, total: number) => total ? "Cost not computed — " + priced + " of " + total + " ingredients priced" : "Cost not computed — no costing yet",
    no_price: "No menu price",
    top: (xs: Array<{ name: string; cost: number }>) => "Top: " + xs.map((x) => x.name + " " + eur(x.cost)).join(" · "),
    say_ok: (n: string, f: number, t: number, over: boolean) => n + " runs at " + f.toFixed(1) + " percent food cost against a " + t.toFixed(0) + " target" + (over ? ". Over — worth a look." : ". In range."),
    say_cost_only: (n: string, c: number) => n + " costs " + eur(c) + " a serving; there is no menu price yet.",
    say_price_only: (n: string, p: number) => n + " sells at " + eur(p) + " but the recipe has no computed cost yet.",
    say_nothing: (n: string) => "I have " + n + " but no cost and no price yet.",
    unknown: "I can't find that dish",
    unknown_say: (q: string) => "I can't find " + q + ". Did you mean one of these?",
    none_say: (q: string) => "I can't find any dish like " + q + " in this house.",
    open: "Open",
  },
} as const;

function eur(n: number) { return (Math.round(n * 100) / 100).toFixed(2).replace(".", ",") + " €"; }
function clip(s: string, n: number) { s = String(s || "").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; }
function norm(s: string) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}
const STOP = new Set(["el", "la", "los", "las", "de", "del", "the", "a", "an", "of", "on", "my", "our", "mi", "un", "una", "plato", "dish", "receta", "recipe"]);
function tokens(s: string) { return norm(s).split(" ").filter((w) => w && !STOP.has(w)); }

// Cheap similarity: token overlap (Dice) with a prefix bonus and a small
// bigram fallback so "cordero" still finds "Cordero lechal" and "lamb"
// finds "Lamb Rack". Good enough for a kitchen vocabulary of a few hundred names.
export function nameScore(query: string, name: string): number {
  const q = tokens(query), n = tokens(name);
  if (!q.length || !n.length) return 0;
  const nq = norm(query), nn = norm(name);
  if (nq === nn) return 1;
  let hit = 0;
  for (const w of q) if (n.some((x) => x === w || x.startsWith(w) || w.startsWith(x) && x.length >= 4)) hit++;
  const dice = (2 * hit) / (q.length + n.length);
  const coverage = hit / q.length; // every word of the question found → long names are not punished
  const prefix = nn.startsWith(nq) ? 0.15 : nn.includes(nq) ? 0.1 : 0;
  // bigram fallback for typos / STT noise
  const bg = (s: string) => { const out = new Set<string>(); const t = s.replace(/ /g, ""); for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2)); return out; };
  const a = bg(nq), b = bg(nn); let inter = 0; for (const x of a) if (b.has(x)) inter++;
  const bigram = a.size && b.size ? (2 * inter) / (a.size + b.size) : 0;
  return Math.min(1, Math.max(0.6 * coverage + 0.4 * dice + prefix, bigram * 0.8));
}

async function candidates(sb: SupabaseClient, scope: FoodCostScope): Promise<Candidate[]> {
  const out: Candidate[] = [];
  if (scope.restaurant_id) {
    const { data } = await sb.from("menu_items").select("id, name, price, cost, computed_cost, recipe_id, target_food_cost_percent, is_active")
      .eq("restaurant_id", scope.restaurant_id).or("is_active.is.null,is_active.eq.true").limit(600);
    for (const r of (data || []) as any[]) out.push({ id: r.id, name: r.name, source: "menu_item", recipe_id: r.recipe_id || null, price: num(r.price), cost: num(r.cost) ?? num(r.computed_cost), target: num(r.target_food_cost_percent) });
  }
  const cols = "id, name, sell_price_eur, menu_price, cost_per_serving_eur, cost_per_portion_eur, linked_menu_item_id";
  const { data: own } = await sb.from("recipes").select(cols).eq("entity_id", scope.entity_id).eq("is_active", true).eq("is_archived", false).limit(1500);
  let rows = (own || []) as any[];
  if (!rows.length) {
    const { data: lib } = await sb.from("recipes").select(cols).is("origin_recipe_id", null).eq("is_active", true).eq("is_archived", false).limit(1500);
    rows = (lib || []) as any[];
  }
  for (const r of rows) out.push({ id: r.id, name: r.name, source: "recipe", recipe_id: r.id, price: num(r.sell_price_eur) ?? num(r.menu_price), cost: num(r.cost_per_serving_eur) ?? num(r.cost_per_portion_eur), target: null });
  return out;
}

function num(v: unknown): number | null { const n = typeof v === "number" ? v : v == null || v === "" ? NaN : Number(v); return Number.isFinite(n) ? n : null; }

export async function readFoodCost(sb: SupabaseClient, q: string, scope: FoodCostScope, lang: ChefLang): Promise<FoodCostResult> {
  const s = S[lang];
  const query = String(q || "").trim();
  const all = await candidates(sb, scope);
  const ranked = all.map((c) => ({ c, score: nameScore(query, c.name) })).filter((x) => x.score > 0).sort((a, b) => b.score - a.score || a.c.name.length - b.c.name.length);
  const best = ranked[0];
  const listHref = scope.house ? "/h/" + scope.house + "/kitchen/recipes" : "/studio/recipes/review";

  // Ambiguous or nothing: clarify with the 3 nearest names (deduped).
  if (!best || best.score < 0.45) {
    const nearest: string[] = [];
    for (const r of ranked) { if (!nearest.includes(r.c.name)) nearest.push(r.c.name); if (nearest.length >= 3) break; }
    const say = nearest.length ? s.unknown_say(clip(query, 40)) : s.none_say(clip(query, 40));
    return {
      found: false, nearest, say,
      card: { title: s.unknown, lines: nearest.length ? nearest.map((n) => clip(n, 70)) : [clip(query, 80)], kind: "read", entity_label: scope.entity_name, href: listHref },
    };
  }

  // Prefer a menu item (it carries the price); pull its recipe for the cost.
  const pick = best.c;
  const menuItem = pick.source === "menu_item" ? pick : ranked.find((x) => x.c.source === "menu_item" && x.score >= best.score - 0.05 && x.c.name.toLowerCase() === pick.name.toLowerCase())?.c || null;
  const recipeId = pick.recipe_id || menuItem?.recipe_id || (pick.source === "recipe" ? pick.id : null);

  let costPerServing: number | null = null;
  let price: number | null = menuItem?.price ?? pick.price ?? null;
  let target = menuItem?.target ?? 30;
  let top: Array<{ name: string; cost: number }> = [];
  let linesTotal = 0, linesPriced = 0;

  if (recipeId) {
    const { data: rec } = await sb.from("recipes").select("id, name, servings, portions, total_cost, cost_per_serving_eur, cost_per_portion_eur, sell_price_eur, menu_price").eq("id", recipeId).maybeSingle();
    const r: any = rec || {};
    const servings = num(r.servings) ?? num(r.portions) ?? null;
    const { data: ing } = await sb.from("recipe_ingredients").select("name, ingredient_name, line_cost").eq("recipe_id", recipeId).limit(200);
    const lines = ((ing || []) as any[]).map((x) => ({ name: String(x.ingredient_name || x.name || "").trim(), cost: num(x.line_cost) }));
    linesTotal = lines.length;
    const priced = lines.filter((l) => l.cost != null && l.cost > 0);
    linesPriced = priced.length;
    top = priced.sort((a, b) => (b.cost as number) - (a.cost as number)).slice(0, 3).map((l) => ({ name: clip(l.name, 22), cost: l.cost as number }));
    const sumLines = priced.reduce((a, l) => a + (l.cost as number), 0);
    const totalCost = num(r.total_cost);
    costPerServing = num(r.cost_per_serving_eur) ?? num(r.cost_per_portion_eur)
      ?? (totalCost && totalCost > 0 && servings ? totalCost / servings : null)
      ?? (sumLines > 0 && servings ? sumLines / servings : null);
    if (price == null) price = num(r.sell_price_eur) ?? num(r.menu_price);
  }
  if (costPerServing == null && menuItem?.cost && menuItem.cost > 0) costPerServing = menuItem.cost;
  if (costPerServing == null && pick.cost && pick.cost > 0) costPerServing = pick.cost;

  const fcp = foodCostPercent(costPerServing, price);
  const over = overTargetAlert(fcp, target);
  const name = pick.name;
  const href = pick.source === "recipe" || recipeId
    ? (scope.house ? "/h/" + scope.house + "/kitchen/recipes/" + (recipeId || pick.id) : listHref)
    : listHref;

  const lines: string[] = [];
  if (costPerServing != null) lines.push(s.cost(round2(costPerServing))); else lines.push(s.no_cost(linesPriced, linesTotal));
  if (price != null) lines.push(s.price(price)); else lines.push(s.no_price);
  if (fcp != null && price != null && costPerServing != null) { lines.push(s.pct(round1(fcp), target)); lines.push(s.margin(round2(price - costPerServing))); }
  if (top.length && lines.length < 4) lines.push(s.top(top));
  else if (top.length) lines[3] = s.top(top); // margin line gives way to the ingredients when all four are taken

  const say = fcp != null ? s.say_ok(name, round1(fcp), target, over)
    : costPerServing != null ? s.say_cost_only(name, round2(costPerServing))
    : price != null ? s.say_price_only(name, price)
    : s.say_nothing(name);

  return {
    found: true, say: clip(say, 160),
    dish: { id: pick.id, name, source: pick.source },
    cost_per_serving: costPerServing, price, food_cost_percent: fcp, target, top,
    card: {
      title: clip(s.title(name), 60), lines: lines.slice(0, 4), kind: "read", entity_label: scope.entity_name, href,
      primary: { label: s.open, kind: "navigate", href },
    },
  };
}
