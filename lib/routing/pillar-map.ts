// Pillar routing — canonical route → pillar mapping.
//
// FOH, BOH, Office replace the old temporal quartet (Develop / Execute /
// Administrate / Grow) as the TOP-LEVEL organizing map. Every existing
// canonical route belongs to exactly one pillar. Longest-prefix wins.
//
// The temporal semantics are preserved as tile-level chips: each tile still
// carries a "flow" (develop | execute | admin | grow) so the operator sees
// where a screen lives in the day/close/menu/guest/team arcs.
//
// Never move the underlying routes — this file is the mapping the top nav,
// role-landing, and the flow footer use. Alias routes (see Commit #2) give
// pillar-scoped URLs that redirect to canonical.

import type { RoleKey } from "@/lib/roles";

export type Pillar = "foh" | "boh" | "office";
export type Flow = "develop" | "execute" | "admin" | "grow";

export const PILLAR_LABEL: Record<Pillar, string> = {
  foh: "FOH",
  boh: "BOH",
  office: "Office",
};

// The per-pillar accent line. FOH inherits the current per-venue accent
// (--accent) at render time; BOH is slate; Office is olive. We surface a
// single CSS variable that the top nav + landing pages read.
export const PILLAR_ACCENT: Record<Pillar, string> = {
  foh: "var(--accent)",   // per-venue (host warmth)
  boh: "#2B3A45",         // slate (kitchen precision)
  office: "#3F4C28",      // olive (operator ledger)
};

export const FLOW_LABEL: Record<Flow, string> = {
  develop: "Develop",
  execute: "Execute",
  admin: "Admin",
  grow: "Grow",
};

// Route-prefix table for canonical routes. Longest prefix wins.
// Ordered specific-first for clarity, but the resolver sorts by length.
const TABLE: { prefix: string; pillar: Pillar }[] = [
  // FOH — hosting, service front, guest arc, drinks/wine service, public menu
  { prefix: "/foh", pillar: "foh" },
  { prefix: "/execute/pass", pillar: "foh" },       // MEP + pass live in Pass — visible to FOH too
  { prefix: "/execute/floor", pillar: "foh" },
  { prefix: "/execute/bookings", pillar: "foh" },
  { prefix: "/grow/relationships", pillar: "foh" },
  { prefix: "/grow/reputation", pillar: "foh" },
  { prefix: "/grow/inbox", pillar: "foh" },
  { prefix: "/m", pillar: "foh" },                  // guest-facing surface
  { prefix: "/menu", pillar: "foh" },               // consumer menu view lives with FOH

  // BOH — kitchen craft, menu development, cook mode, prep, receiving
  { prefix: "/boh", pillar: "boh" },
  { prefix: "/develop/menu", pillar: "boh" },
  { prefix: "/develop/menu-engineering", pillar: "boh" },
  { prefix: "/develop/recipes", pillar: "boh" },
  { prefix: "/develop/lexicon", pillar: "boh" },
  { prefix: "/develop/wine", pillar: "boh" },
  { prefix: "/develop/bar", pillar: "boh" },
  { prefix: "/develop/academy", pillar: "boh" },
  { prefix: "/develop/repricing", pillar: "boh" },
  { prefix: "/develop", pillar: "boh" },
  { prefix: "/execute/cook", pillar: "boh" },
  { prefix: "/execute/mep", pillar: "boh" },
  { prefix: "/execute/orders", pillar: "boh" },
  { prefix: "/execute/receiving", pillar: "boh" },
  { prefix: "/execute/inventory", pillar: "boh" },
  { prefix: "/execute/temp", pillar: "boh" },
  { prefix: "/execute/handover", pillar: "boh" },
  { prefix: "/execute", pillar: "boh" },
  { prefix: "/recipes", pillar: "boh" },
  { prefix: "/order", pillar: "boh" },

  // Office — books, team, holdings, ads, commercials, gestoría
  { prefix: "/office", pillar: "office" },
  { prefix: "/administrate", pillar: "office" },
  { prefix: "/grow/reach", pillar: "office" },
  { prefix: "/grow/commercials", pillar: "office" },
  { prefix: "/grow", pillar: "office" },
  { prefix: "/schedule", pillar: "office" },
  { prefix: "/messages", pillar: "office" },
  { prefix: "/team", pillar: "office" },
  { prefix: "/academy", pillar: "office" },
  { prefix: "/onboard", pillar: "office" },
  { prefix: "/welcome", pillar: "office" },
  { prefix: "/account", pillar: "office" },
  { prefix: "/command", pillar: "office" },
];

// The "Files" module is universal — not owned by any pillar. We surface it in
// the top nav separately (small icon) so it stays reachable in every world.
export const FILES_PREFIX = "/files";

// Sort once at import so runtime lookup is O(n) longest-prefix-first.
const SORTED = TABLE.slice().sort((a, b) => b.prefix.length - a.prefix.length);

export function pillarForRoute(pathname: string | null | undefined): Pillar | null {
  if (!pathname) return null;
  if (pathname === "/" || pathname.startsWith(FILES_PREFIX)) return null;
  const hit = SORTED.find((row) => pathname === row.prefix || pathname.startsWith(row.prefix + "/"));
  return hit ? hit.pillar : null;
}

// Given a role, where does the operator land after sign-in?
// Chef/prep/porter/pastry → BOH; FOH/host/manager on service → FOH;
// Owner/gestoría/advisor → Office. Unknown → Office (safe fallback for admins).
export function pillarForRole(dbRole: string | null | undefined, world: RoleKey): Pillar {
  const r = (dbRole || "").toLowerCase();
  // Explicit BOH markers win first (chef could also be manager/owner in the org tree).
  if (["chef", "cook", "kitchen", "pastry", "prep", "porter", "boh", "back"].some((k) => r.includes(k))) return "boh";
  if (["host", "waiter", "server", "maitre", "maître", "somm", "bar", "floor", "foh", "front"].some((k) => r.includes(k))) return "foh";
  if (["owner", "gestor", "gestoria", "gestoría", "advisor", "accountant", "director", "admin", "operator"].some((k) => r.includes(k))) return "office";
  // Fall back to the derived world (mapDbRole in lib/roles).
  if (world === "boh") return "boh";
  if (world === "foh") return "foh";
  return "office";
}

// Landing route per pillar. Used by role-based auto-landing on /.
export const PILLAR_LANDING: Record<Pillar, string> = {
  foh: "/foh",
  boh: "/boh",
  office: "/office",
};
