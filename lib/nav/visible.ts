// visible.ts — ONE function that decides which verbs and leaves a person sees.
// Used by the three renderers (components/nav/Dock.tsx, components/DesktopSidebar.tsx,
// components/CommandK.tsx) so the dock, the rail and ⌘K never disagree
// (TO_BORIS_cook_preflight_2026-10-02 §1e: the gates existed, only ⌘K read them).
//
//   manager / owner           six verbs, every leaf
//   cook · foh (worker-class) Service · Menu · Team, + Supplies when the
//                             membership has can_receive = true; leaves keep
//                             their room gates (Pass/Prep for kitchen, Floor/
//                             Guests for dining, Rota/Hiring/Invite/Costing office)
//   not loaded / signed out   NO_ACCESS → ungated verbs only (fail closed)
//
// Pure: no React, no fetch. The hook that loads access is lib/nav/useNavAccess.ts.

import { verbsFor, type NavTreeKey, type NavVerb, type NavLeaf } from "@/lib/nav";
import { canSeeRoute, paletteAccessFor, NO_ACCESS, type PaletteAccess } from "@/lib/access/tenantScope";
import type { MyAccess } from "@/lib/access/myAccess";

export function visibleVerbs(tree: NavTreeKey, access: PaletteAccess): NavVerb[] {
  return verbsFor(tree)
    .filter((v) => canSeeRoute(v.gate || {}, access))
    .map((v) => ({ ...v, leaves: v.leaves.filter((l) => canSeeRoute(l.gate || {}, access)) }));
}

// Every navigable row of a tree, "Verb · Leaf", already filtered — the ⌘K list.
export function visibleRows(tree: NavTreeKey, access: PaletteAccess, word: (v: NavVerb) => string = (v) => v.label): Array<NavLeaf & { verb: string }> {
  const out: Array<NavLeaf & { verb: string }> = [];
  for (const v of visibleVerbs(tree, access)) {
    const w = word(v);
    out.push({ href: v.href, label: w, hint: v.hint, gate: v.gate, verb: v.key });
    for (const l of v.leaves) out.push({ ...l, label: `${w} · ${l.label}`, verb: v.key });
  }
  return out;
}

// Access for the house in scope. `houseSlug` from the URL (/h/<slug>) or the
// cookie; null = portfolio (Studio) → evaluated across every accessible house.
export function accessForHouse(my: MyAccess | null, houseSlug: string | null, fallbackEntityId: string | null = null): PaletteAccess {
  if (!my) return NO_ACCESS;
  const ctxId = houseSlug
    ? (my.entities.find((e) => e.slug === houseSlug)?.id ?? null)
    : fallbackEntityId;
  return paletteAccessFor(my.entities, my.memberships, ctxId);
}
