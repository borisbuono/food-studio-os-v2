export type RoleKey = "office" | "foh" | "boh";

export const ROLES: Record<RoleKey, { label: string; points: { href: string; label: string; blurb: string }[] }> = {
  office: {
    label: "Office",
    points: [
      { href: "/grow/reputation", label: "Reviews", blurb: "What guests wrote — what needs a reply." },
      { href: "/administrate/team", label: "Team", blurb: "Everyone on the team, in one place." },
      { href: "/administrate/finance", label: "The numbers", blurb: "What's moving — revenue, covers, costs to react to." },
      { href: "/administrate/suppliers", label: "Suppliers", blurb: "Orders, prices, deliveries." },
    ],
  },
  boh: {
    label: "Back of House",
    points: [
      { href: "/execute/pass", label: "The Pass", blurb: "Tonight's prep + cleaning + close-down, scaled to tomorrow's covers." },
      { href: "/execute/orders", label: "Orders", blurb: "What came in, what to order." },
    ],
  },
  foh: {
    label: "Front of House",
    points: [
      { href: "/execute/pass", label: "The Pass", blurb: "Tonight: covers, specials, 86s, close-down." },
      { href: "/grow/relationships", label: "Guests", blurb: "Who is coming back, what they like." },
      { href: "/administrate/events", label: "Events", blurb: "Private events and catering." },
      { href: "/administrate/team/schedule", label: "Schedule", blurb: "Who is on, when." },
    ],
  },
};

// DB role vocabulary (team_members.default_role): worker | chef | maitre | manager | owner.
// Map each to an app "world" + whether they are an admin (can switch venues / see Office).
export type World = RoleKey; // "office" | "foh" | "boh"
export function mapDbRole(dbRole: string | null | undefined): { world: World; isAdmin: boolean } {
  const r = (dbRole || "").toLowerCase();
  if (["owner", "manager", "gm", "admin", "director", "operator"].some((k) => r.includes(k)))
    return { world: "office", isAdmin: true };
  if (["chef", "cook", "kitchen", "pastry", "prep", "boh", "back"].some((k) => r.includes(k)))
    return { world: "boh", isAdmin: false };
  if (["maitre", "maître", "foh", "waiter", "server", "host", "somm", "bar", "floor", "front"].some((k) => r.includes(k)))
    return { world: "foh", isAdmin: false };
  return { world: "foh", isAdmin: false }; // generic "worker" → front-of-house minimal surface
}

// Routes only an admin (Office) may open. Non-admins are redirected home.
// Pillars #1 — Office-only prefixes for the RouteGuard defence-in-depth.
// The Office pillar is /office + /administrate/*. Some /grow branches
// (reach, commercials) are Office too; FOH-relevant /grow branches
// (relationships, reputation, inbox) stay open. The pillar-map is the
// canonical routing source; this list is the shorter "hard block" set.
export const OFFICE_ONLY_PREFIXES = [
  "/administrate",
  "/grow/reach",
  "/grow/commercials",
];
