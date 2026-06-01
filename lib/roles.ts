export type RoleKey = "office" | "foh" | "boh";

export const ROLES: Record<RoleKey, { label: string; points: { href: string; label: string; blurb: string }[] }> = {
  office: {
    label: "Office",
    points: [
      { href: "/administrate/decisions", label: "Inbox", blurb: "Emails, requests, reviews — what needs a reply or a call." },
      { href: "/messages", label: "Team", blurb: "Everyone the team, in one place: channels, roster, message anyone." },
      { href: "/administrate/finance", label: "The numbers", blurb: "What's moving — revenue, covers, costs to react to." },
      { href: "/administrate/suppliers", label: "Suppliers", blurb: "Orders, prices, deliveries." },
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
      { href: "/execute/handover", label: "The Pass", blurb: "Tonight: covers, specials, 86s, close-down." },
      { href: "/menu", label: "Menu", blurb: "Sell and present every dish." },
      { href: "/administrate/events", label: "Events", blurb: "Private events and catering." },
      { href: "/schedule", label: "Schedule", blurb: "Who is on, when." },
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
