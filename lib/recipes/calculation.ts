// Recipe Calculation (escandallo) engine — the numbers side of a recipe.
//
// - Ingredient line costs derive from inventory_items.unit_cost when the
//   parser matched an ingredient to inventory; otherwise fall back to any
//   line_cost persisted on recipe_ingredients (chef override).
// - cost_per_serving = sum(line_cost) / servings, persisted on recipes.
// - suggested_price = cost_per_serving / (target_food_cost_percent / 100).
// - food_cost_percent_actual = cost_per_serving / menu_price * 100.
// - Alert when food_cost_percent_actual > target_food_cost_percent + 5.

export type IngredientRow = {
  id?: string;
  ingredient_name?: string | null;
  name?: string | null;
  quantity?: number | null;
  unit?: string | null;
  line_cost?: number | null;
  ingredient_id?: string | null;
  is_optional?: boolean | null;
};

export type InventoryLookup = Record<string, { unit_cost: number | null; unit: string | null; name: string | null }>;
export type NameLookup = Record<string, number>; // normalized name -> unit_cost eur

// Normalize an ingredient name to a lookup key: lowercase, strip accents,
// collapse whitespace, remove trailing parentheticals.
export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Compute a per-line cost. Order of precedence:
//   1. line_cost persisted on the ingredient row (chef override)
//   2. inventory match on ingredient_id * quantity
//   3. name-based match (normalized) against a { name -> unit_cost } table
//   4. null (no cost known yet)
export function costLine(
  row: IngredientRow,
  inventory: InventoryLookup,
  byName: NameLookup
): number | null {
  if (typeof row.line_cost === "number" && Number.isFinite(row.line_cost)) return row.line_cost;
  const qty = Number(row.quantity ?? NaN);
  if (!Number.isFinite(qty)) return null;
  if (row.ingredient_id && inventory[row.ingredient_id]?.unit_cost != null) {
    return round2(qty * (inventory[row.ingredient_id].unit_cost as number));
  }
  const key = normalizeName(String(row.ingredient_name || row.name || ""));
  if (key && byName[key] != null) return round2(qty * byName[key]);
  return null;
}

export function costRecipe(rows: IngredientRow[], inventory: InventoryLookup, byName: NameLookup) {
  let total = 0;
  let priced = 0;
  let missing = 0;
  const lines: Array<{ row: IngredientRow; line_cost: number | null }> = [];
  for (const row of rows) {
    if (row.is_optional) { lines.push({ row, line_cost: null }); continue; }
    const line = costLine(row, inventory, byName);
    lines.push({ row, line_cost: line });
    if (line != null) { total += line; priced += 1; } else { missing += 1; }
  }
  return { total: round2(total), priced, missing, lines };
}

export function calcCostPerServing(totalCost: number, servings: number | null | undefined): number | null {
  if (!servings || servings <= 0) return null;
  return round2(totalCost / servings);
}

export function suggestedPrice(costPerServing: number | null, targetPct: number | null): number | null {
  if (costPerServing == null || !targetPct || targetPct <= 0) return null;
  return round2(costPerServing / (targetPct / 100));
}

export function foodCostPercent(costPerServing: number | null, menuPrice: number | null): number | null {
  if (costPerServing == null || !menuPrice || menuPrice <= 0) return null;
  return round1((costPerServing / menuPrice) * 100);
}

export function overTargetAlert(actualPct: number | null, targetPct: number | null): boolean {
  if (actualPct == null || targetPct == null) return false;
  return actualPct > targetPct + 5;
}

export function round1(n: number): number { return Math.round(n * 10) / 10; }
export function round2(n: number): number { return Math.round(n * 100) / 100; }

// Menu-engineering classifier — Kasavana & Smith Boston-matrix.
// High margin + high popularity = Star; low + high = Plowhorse; high + low = Puzzle;
// low + low = Dog. Averages come from the population; classify vs. averages.
export type EngineeringRow = {
  id: string;
  name: string;
  menu_price: number;
  cost_per_serving: number;
  units_sold: number;
};

export type EngineeringClass = "star" | "plow" | "puzzle" | "dog";

export function classifyEngineering(rows: EngineeringRow[]): Array<EngineeringRow & { margin: number; contribution: number; klass: EngineeringClass }> {
  if (!rows.length) return [];
  const withMargin = rows.map((r) => ({
    ...r,
    margin: round2(r.menu_price - r.cost_per_serving),
    contribution: round2((r.menu_price - r.cost_per_serving) * r.units_sold),
  }));
  const avgMargin = withMargin.reduce((s, r) => s + r.margin, 0) / withMargin.length;
  const avgUnits = withMargin.reduce((s, r) => s + r.units_sold, 0) / withMargin.length;
  return withMargin.map((r) => {
    const hiM = r.margin >= avgMargin;
    const hiP = r.units_sold >= avgUnits;
    const klass: EngineeringClass = hiM && hiP ? "star" : !hiM && hiP ? "plow" : hiM && !hiP ? "puzzle" : "dog";
    return { ...r, klass };
  });
}
