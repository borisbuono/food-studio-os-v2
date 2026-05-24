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
      { href: "/administrate/team", label: "Schedule", blurb: "Who's on, when." },
    ],
  },
};
