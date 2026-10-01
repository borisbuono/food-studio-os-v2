// costVisibility.ts — ONE flag for "who sees recipe costs" (2026-10-02).
//
// Pending Boris's answer to preflight QUESTION 3 (should a line cook see — and
// edit — recipe costs?), costs are MANAGER+ ONLY: the Costing tab on the recipe
// page, the Costing leaf under Menu (lib/nav.ts, office gate) and the Chef
// `food_cost` answer. Flip COST_VISIBLE_TO to "member" and all three open to
// every member of the house; nothing else to change.
//
// Pure module (no Supabase): callers pass the manager verdict they already hold
// (fn_is_entity_manager / PaletteAccess.rooms.has("office")).

export type CostAudience = "manager" | "member";

export const COST_VISIBLE_TO: CostAudience = "manager";

export function canSeeCost(isManager: boolean): boolean {
  return COST_VISIBLE_TO === "member" || isManager;
}
