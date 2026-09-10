// copyBridge.ts — small bridge between the funnel copy stub and the
// capture form. Kept next to the form to avoid a client component
// depending on server-only imports.

import { resolveFunnelCopy as resolve, type FunnelScope } from "@/content/funnel/config";

export function normaliseFunnelScopeInput(raw: string): FunnelScope {
  const s = String(raw || "").trim().toLowerCase();
  if (s === "bm" || s === "bistro-mondo" || s === "bistrot-mondo") return "bm";
  if (s === "taller" || s === "taller-sa-penya" || s === "ibiza-food-lab" || s === "ifl") return "taller";
  return "studio";
}

export const resolveFunnelCopy = resolve;
