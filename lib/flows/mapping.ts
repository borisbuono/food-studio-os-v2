// Architecture v2 — the 5 canonical flows.
// Every non-home page in the OS belongs to exactly one flow. This mapping
// is THE source of truth for the FlowStrip footer.
//
// The 5 flows (per os_architecture_v2_flows_not_modules_2026-07-07.md):
//   1. Daily loop            — Morning → Deliveries → Prep → Service → EOD
//   2. Invoice → close       — Inbox → approve → match bank → asiento → close
//   3. Menu → cost → sale    — ingredient → recipe → menu item → POS
//   4. Guest arc             — booking → recognise → serve → feedback → repeat
//   5. Team member arc       — onboard → clock → serve → train → payroll

export type FlowKey = "daily_loop" | "invoice_close" | "menu_sale" | "guest_arc" | "team_arc";

export type FlowStep = {
  flow: FlowKey;
  step: string;
  // Human-readable name of the flow for the strip
  flowLabel: string;
};

export const FLOW_LABEL: Record<FlowKey, string> = {
  daily_loop: "Daily loop",
  invoice_close: "Invoice → close",
  menu_sale: "Menu → cost → sale",
  guest_arc: "Guest arc",
  team_arc: "Team member arc",
};

// Route-prefix table. Match is longest-prefix-wins so more specific routes
// win over their parents. Order the table with specific first.
const TABLE: { prefix: string; flow: FlowKey; step: string }[] = [
  // --- daily loop -----------------------------------------------------------
  { prefix: "/execute/receiving", flow: "daily_loop", step: "Deliveries step" },
  { prefix: "/execute/handover", flow: "daily_loop", step: "Prep + pass step" },
  { prefix: "/execute/floor", flow: "daily_loop", step: "Service step" },
  { prefix: "/execute/bookings", flow: "daily_loop", step: "Service step" },
  { prefix: "/execute/inventory", flow: "daily_loop", step: "Prep + pass step" },
  { prefix: "/execute/temp", flow: "daily_loop", step: "Service step" },
  { prefix: "/execute", flow: "daily_loop", step: "Service step" },
  { prefix: "/schedule", flow: "daily_loop", step: "Roster step" },

  // --- invoice → close ------------------------------------------------------
  { prefix: "/administrate/finance/scans", flow: "invoice_close", step: "Inbox triage step" },
  { prefix: "/administrate/finance/reconciliation", flow: "invoice_close", step: "Reconciliation step" },
  { prefix: "/administrate/finance/eod", flow: "invoice_close", step: "EOD close step" },
  { prefix: "/administrate/finance/costs", flow: "invoice_close", step: "Costs review step" },
  { prefix: "/administrate/finance/variance", flow: "invoice_close", step: "Variance step" },
  { prefix: "/administrate/finance/forecast", flow: "invoice_close", step: "Forecast step" },
  { prefix: "/administrate/finance/dashboard", flow: "invoice_close", step: "Cockpit step" },
  { prefix: "/administrate/finance/integrations", flow: "invoice_close", step: "Substrate step" },
  { prefix: "/administrate/finance/setup", flow: "invoice_close", step: "Substrate step" },
  { prefix: "/administrate/finance", flow: "invoice_close", step: "Cockpit step" },
  { prefix: "/administrate/invoices", flow: "invoice_close", step: "Supplier docs step" },
  { prefix: "/administrate/cashflow", flow: "invoice_close", step: "Cash tracking step" },
  { prefix: "/administrate/holdings", flow: "invoice_close", step: "Group close step" },

  // --- menu → cost → sale ---------------------------------------------------
  { prefix: "/develop/menu-engineering", flow: "menu_sale", step: "Menu engineering step" },
  { prefix: "/develop/repricing", flow: "menu_sale", step: "Repricing step" },
  { prefix: "/develop/wine", flow: "menu_sale", step: "Wine catalogue step" },
  { prefix: "/develop/bar", flow: "menu_sale", step: "Bar catalogue step" },
  { prefix: "/develop/lexicon", flow: "menu_sale", step: "Ingredient lexicon step" },
  { prefix: "/develop", flow: "menu_sale", step: "Recipe editing step" },
  { prefix: "/menu", flow: "menu_sale", step: "Menu item step" },
  { prefix: "/recipes", flow: "menu_sale", step: "Recipe editing step" },
  { prefix: "/order", flow: "menu_sale", step: "Ordering step" },
  { prefix: "/administrate/suppliers", flow: "menu_sale", step: "Supplier profile step" },

  // --- guest arc ------------------------------------------------------------
  { prefix: "/grow/relationships", flow: "guest_arc", step: "Profile step" },
  { prefix: "/grow/commercials", flow: "guest_arc", step: "Offer step" },
  { prefix: "/grow/reach", flow: "guest_arc", step: "Campaign step" },
  { prefix: "/grow/reputation", flow: "guest_arc", step: "Feedback step" },
  { prefix: "/grow/inbox", flow: "guest_arc", step: "Signals step" },
  { prefix: "/grow", flow: "guest_arc", step: "Overview step" },
  { prefix: "/administrate/events", flow: "guest_arc", step: "Private events step" },
  { prefix: "/administrate/decisions", flow: "guest_arc", step: "Signals step" },
  { prefix: "/administrate/feedback", flow: "guest_arc", step: "Feedback step" },

  // --- team member arc -----------------------------------------------------
  { prefix: "/administrate/team", flow: "team_arc", step: "Roster step" },
  { prefix: "/academy", flow: "team_arc", step: "Training step" },
  { prefix: "/messages", flow: "team_arc", step: "Team comms step" },
  { prefix: "/onboard", flow: "team_arc", step: "Onboarding step" },
  { prefix: "/welcome", flow: "team_arc", step: "Onboarding step" },
  { prefix: "/account", flow: "team_arc", step: "Profile step" },
];

// Longest-prefix-wins router. Returns null when no flow matches (e.g. /, /login).
export function flowForRoute(pathname: string): FlowStep | null {
  const matches = TABLE.filter((row) => pathname === row.prefix || pathname.startsWith(row.prefix + "/"));
  if (matches.length === 0) return null;
  const best = matches.reduce((a, b) => (b.prefix.length > a.prefix.length ? b : a));
  return { flow: best.flow, step: best.step, flowLabel: FLOW_LABEL[best.flow] };
}
