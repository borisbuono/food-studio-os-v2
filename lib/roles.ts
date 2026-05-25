export type RoleKey = "office" | "foh" | "boh";

export const ROLES: Record<RoleKey, { label: string; points: { href: string; label: string; blurb: string }[] }> = {
  office: {
    label: "Office",
    points: [
      { href: "/administrate/finance", label: "Finance", blurb: "Revenue, covers — the numbers explained." },
      { href: "/administrate/decisions", label: "Decisions", blurb: "What needs a call." },
      { href: "/administrate/team", label: "Team", blurb: "HR, the roster, the schedule." },
      { href: "/administrate/holdings", label: "Holdings", blurb: "The group, venue by venue." },
      { href: "/administrate/settings", label: "Settings", blurb: "Connections and skills." },
    ],
  },
  boh: {
    label: "Back of House",
    points: [
      { href: "/execute/today", label: "Today", blurb: "Your priority prep and cleaning." },
      { href: "/menu", label: "Menu", blurb: "Every dish, its recipe and story." },
      { href: "/recipes", label: "Recipes", blurb: "The library, with cook mode." },
      { href: "/execute/prep", label: "Prep", blurb: "Mise en place by station." },
      { href: "/execute/cleaning", label: "Cleaning", blurb: "Daily and weekly, by station." },
    ],
  },
  foh: {
    label: "Front of House",
    points: [
      { href: "/execute/today", label: "Today", blurb: "Covers and what's on." },
      { href: "/menu", label: "Menu", blurb: "Sell and present every dish." },
      { href: "/administrate/events", label: "Events", blurb: "Private events and catering." },
      { href: "/execute/cleaning", label: "Cleaning", blurb: "Front-of-house close-down." },
      { href: "/schedule", label: "Schedule", blurb: "Who's on, when." },
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
export const OFFICE_ONLY_PREFIXES = ["/administrate"];
