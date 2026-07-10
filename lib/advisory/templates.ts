// Advisory Sprint #3 — venue templates for the productised onboarding.
//
// Each template is a bundle of seeds an advisor can drop onto a new
// advisory client: an assistant voice + dial preset, a set of playbooks,
// a menu skeleton, a supplier list, a POS default, and a chart-of-accounts
// baseline. Templates are ADDITIVE — after the wizard runs the advisor can
// edit anything.
//
// We deliberately keep the templates as pure data (no imports) so both the
// wizard's client-side preview and the server-side seed path can read from
// the same source.

import type { AdvisoryTier } from "./types";

export type AdvisoryPlaybookSeed = {
  name: string;
  description: string;
  priority: number;
  triage_rules: any[];
};

export type AdvisoryMenuSectionSeed = {
  section: string;
  items: string[];
};

export type AdvisoryTemplateSeed = {
  key: "bistrot_du_monde" | "cala_boix" | "blank";
  label: string;
  short_description: string;

  // Kind of operator this template models
  operator_shape: string;

  // Assistant voice
  voice_profile: string;
  personality_dials: { formality: number; warmth: number; brevity: number };
  timezone: string;
  suggested_tier: AdvisoryTier;

  // Playbook seeds — dropped into assistant_playbooks
  playbooks: AdvisoryPlaybookSeed[];

  // Menu skeleton — dropped as a starter set of dishes
  menu_skeleton: AdvisoryMenuSectionSeed[];

  // Common suppliers — pre-populates the supplier picker
  common_suppliers: string[];

  // POS defaults for Fresto
  pos_defaults: {
    provider: "fresto" | "square" | "lightspeed" | "none";
    service_charge_pct: number;
    default_vat_pct: number;
    tables: number;
  };

  // Chart-of-accounts base — Spanish PGC codes with a starter chart
  chart_of_accounts: { code: string; label: string; type: "revenue" | "cogs" | "opex" | "capex" | "tax" }[];

  // Activation checklist steps — copied into advisory_checklist_items on creation
  checklist_steps: { key: string; label: string; hint: string }[];
};

// ─────────────────────────────────────────────────────────────────────────
// Bistrot du Monde — Michael / Santa Gertrudis group
// French-leaning bistro on a 10-year lease. Delivered deck: €530k build,
// €3.5k monthly rent, Y1 revenue €709k → Y5 €1.04M.
// ─────────────────────────────────────────────────────────────────────────
const BISTROT_DU_MONDE: AdvisoryTemplateSeed = {
  key: "bistrot_du_monde",
  label: "Bistrot du Monde",
  short_description:
    "French bistro on a long lease, delivered deck, Michael's Santa Gertrudis group.",
  operator_shape:
    "French-leaning bistro, 10-year lease, ~60 seats, dinner-led with weekend lunch. Owner-operator on-site through opening.",
  voice_profile:
    "The voice of a warm French bistrot in Santa Gertrudis. Polite, quietly proud of the room. Sentences short. Uses Spanish when a Spanish supplier writes. Never gushing.",
  personality_dials: { formality: 0.55, warmth: 0.7, brevity: 0.55 },
  timezone: "Europe/Madrid",
  suggested_tier: "advisory",
  playbooks: [
    {
      name: "Bookings first — always",
      description:
        "Reservations, changes, cancellations. Top priority — the Maître reads these before service.",
      priority: 10,
      triage_rules: [
        { match: "subject_or_body_contains", any: ["booking","reservation","cancel","change","table","reserva","reservar","annulation"] },
        { assign: { priority: 1, category: "bookings", suggested_action: "draft_reply" } },
      ],
    },
    {
      name: "Suppliers — mise and wine",
      description:
        "Deliveries, invoices, statements. Draft a short reply; forward the invoice to the scan inbox.",
      priority: 20,
      triage_rules: [
        { match: "subject_or_body_contains", any: ["invoice","factura","albarán","facture","payment","overdue","proveedor"] },
        { assign: { priority: 2, category: "suppliers", suggested_action: "flag" } },
      ],
    },
    {
      name: "Investors + landlord",
      description:
        "Michael's group, the landlord, the design team. Priority 3, drafted for a second read.",
      priority: 30,
      triage_rules: [
        { match: "subject_or_body_contains", any: ["investor","landlord","architect","permit","licence","licencia"] },
        { assign: { priority: 3, category: "projects", suggested_action: "draft_reply" } },
      ],
    },
  ],
  menu_skeleton: [
    { section: "Pour commencer", items: ["Œuf mayo", "Rillettes de canard", "Salade lyonnaise"] },
    { section: "Les plats",       items: ["Steak frites", "Poulet rôti", "Loup de mer grillé"] },
    { section: "Fromages + desserts", items: ["Assiette de fromages", "Tarte tatin", "Île flottante"] },
  ],
  common_suppliers: [
    "Aibsa",         // dairy + charcuterie in Ibiza
    "Mercadona",     // dry goods
    "Nobe",          // fish + shellfish
    "Ecoveritas",    // organic produce
    "Wineloveribiza",// wine
    "Meneghello",    // Italian speciality
  ],
  pos_defaults: {
    provider: "fresto",
    service_charge_pct: 0,
    default_vat_pct: 10,
    tables: 16,
  },
  chart_of_accounts: [
    { code: "700",     label: "Ventas — food",     type: "revenue" },
    { code: "705",     label: "Ventas — beverage", type: "revenue" },
    { code: "600",     label: "Compras — food",    type: "cogs"    },
    { code: "601",     label: "Compras — beverage",type: "cogs"    },
    { code: "621",     label: "Rent",              type: "opex"    },
    { code: "640",     label: "Wages",             type: "opex"    },
    { code: "477",     label: "IVA repercutido",   type: "tax"     },
  ],
  checklist_steps: [
    { key: "entity_created",     label: "Advisory entity created",  hint: "ADV-<slug> code is stable across surfaces." },
    { key: "venue_configured",   label: "Venue configured",         hint: "Name, address, seats, opening date." },
    { key: "holded_connected",   label: "Holded connected",         hint: "New Holded account or invite advisor to existing." },
    { key: "pos_connected",      label: "Fresto POS connected",     hint: "Menu, tax rates, tables. Test settlement." },
    { key: "bank_connected",     label: "Bank connected",           hint: "CaixaBank or partner via Chift." },
    { key: "assistant_configured", label: "Assistant voice tuned",  hint: "Voice + dials + playbooks. Wizard did the first pass." },
    { key: "channels_connected", label: "Channels connected",       hint: "Gmail + WhatsApp for triage and drafts." },
    { key: "team_invited",       label: "Team seats invited",       hint: "Owner + manager + FOH lead." },
    { key: "trained",            label: "Owner-operator trained",   hint: "Chef FAB walkthrough. First morning brief lands live." },
  ],
};

// ─────────────────────────────────────────────────────────────────────────
// Cala Boix — Ralf's cliffside villa restaurant
// Mixed lease (8-10% of revenue). Seasonal: Easter → Halloween full-time,
// weekends year-round.
// ─────────────────────────────────────────────────────────────────────────
const CALA_BOIX: AdvisoryTemplateSeed = {
  key: "cala_boix",
  label: "Cala Boix",
  short_description:
    "Cliffside villa restaurant, seasonal ops, mixed lease with Ralf.",
  operator_shape:
    "Villa-restaurant on a cliff. Partner-run (Ralf owner, 10-20 year lease). Full-time Easter → Halloween, weekends the rest of the year. Small kitchen, view-led room.",
  voice_profile:
    "The voice of a small cliffside restaurant. Quiet, unshowy, weather-aware. Sentences short. Notices the sea. Never oversells — the view does that.",
  personality_dials: { formality: 0.4, warmth: 0.75, brevity: 0.65 },
  timezone: "Europe/Madrid",
  suggested_tier: "advisory",
  playbooks: [
    {
      name: "Booking waves + weather",
      description:
        "Bookings arrive in waves after a good weather forecast. Treat every reservation like the last table.",
      priority: 10,
      triage_rules: [
        { match: "subject_or_body_contains", any: ["booking","reservation","reserva","weather","viento","tramuntana"] },
        { assign: { priority: 1, category: "bookings", suggested_action: "draft_reply" } },
      ],
    },
    {
      name: "Ralf + partner comms",
      description:
        "Anything from Ralf (owner) or the landlord company. Priority 2 — drafted for a second read.",
      priority: 15,
      triage_rules: [
        { match: "subject_or_body_contains", any: ["ralf","landlord","lease","alquiler","contrato"] },
        { assign: { priority: 2, category: "partner", suggested_action: "draft_reply" } },
      ],
    },
    {
      name: "Seasonal supplier catch-up",
      description:
        "Seasonal suppliers vanish for winter. Any invoice or delivery note is priority 2 during the shoulders.",
      priority: 25,
      triage_rules: [
        { match: "subject_or_body_contains", any: ["invoice","factura","delivery","albarán","supplier"] },
        { assign: { priority: 2, category: "suppliers", suggested_action: "flag" } },
      ],
    },
  ],
  menu_skeleton: [
    { section: "To share",  items: ["Marinated anchovies", "Pan con tomate", "Grilled prawns"] },
    { section: "From the sea", items: ["Whole fish, grilled", "Squid ink rice", "Lobster + fideos"] },
    { section: "Sweet",     items: ["Almond cake", "Sorbet — market fruit"] },
  ],
  common_suppliers: [
    "Nobe",
    "Aibsa",
    "Ecoveritas",
    "Mercadona",
    "Bodegas Ibizkus",
    "Sa Pedrera",
  ],
  pos_defaults: {
    provider: "fresto",
    service_charge_pct: 0,
    default_vat_pct: 10,
    tables: 12,
  },
  chart_of_accounts: [
    { code: "700", label: "Ventas — food",     type: "revenue" },
    { code: "705", label: "Ventas — beverage", type: "revenue" },
    { code: "600", label: "Compras — food",    type: "cogs"    },
    { code: "601", label: "Compras — beverage",type: "cogs"    },
    { code: "621", label: "Rent — % of revenue", type: "opex"  },
    { code: "640", label: "Wages",             type: "opex"    },
    { code: "477", label: "IVA repercutido",   type: "tax"     },
  ],
  checklist_steps: [
    { key: "entity_created",       label: "Advisory entity created",      hint: "ADV-cala-boix or similar slug." },
    { key: "venue_configured",     label: "Venue configured",             hint: "Cliff address, ~50 seats, seasonal calendar." },
    { key: "partner_agreement",    label: "Partner agreement filed",      hint: "Ralf lease + revenue-share terms saved to legal folder." },
    { key: "holded_connected",     label: "Holded connected",             hint: "Own account with revenue-share posting rule." },
    { key: "pos_connected",        label: "Fresto POS connected",         hint: "Seasonal menu + view-led tables." },
    { key: "bank_connected",       label: "Bank connected",               hint: "Split accounts if revenue share is same-account." },
    { key: "assistant_configured", label: "Assistant voice tuned",        hint: "Cliffside voice + weather-aware playbooks." },
    { key: "channels_connected",   label: "Channels connected",           hint: "Gmail + WhatsApp." },
    { key: "team_invited",         label: "Team seats invited",           hint: "Ralf as owner. Head chef. FOH lead." },
    { key: "trained",              label: "Owner-operator trained",       hint: "Walkthrough on the terrace." },
  ],
};

// ─────────────────────────────────────────────────────────────────────────
// Blank — for Serena referrals and unknown venue types
// Neutral defaults. Advisor customises after the wizard.
// ─────────────────────────────────────────────────────────────────────────
const BLANK: AdvisoryTemplateSeed = {
  key: "blank",
  label: "Blank slate",
  short_description:
    "Neutral defaults — for Serena Deliciously Sorted referrals and unknown venue types.",
  operator_shape:
    "Any hospitality operation. The advisor tunes voice, playbooks, menu and suppliers after the wizard.",
  voice_profile:
    "Warm, brief, quietly professional. English by default; switches to Spanish when the sender writes in Spanish.",
  personality_dials: { formality: 0.5, warmth: 0.65, brevity: 0.6 },
  timezone: "Europe/Madrid",
  suggested_tier: "advisory",
  playbooks: [
    {
      name: "Bookings before anything else",
      description:
        "A reservation, a change, a cancellation — front of house feels it first.",
      priority: 10,
      triage_rules: [
        { match: "subject_or_body_contains", any: ["booking","reservation","cancel","change","table","reserva"] },
        { assign: { priority: 1, category: "bookings", suggested_action: "draft_reply" } },
      ],
    },
    {
      name: "Suppliers and invoices",
      description:
        "Statements, invoices, delivery confirmations. Draft short replies; forward invoices to scan.",
      priority: 20,
      triage_rules: [
        { match: "subject_or_body_contains", any: ["invoice","factura","albarán","payment","supplier","proveedor"] },
        { assign: { priority: 2, category: "suppliers", suggested_action: "flag" } },
      ],
    },
    {
      name: "Personal, treated last",
      description:
        "Newsletters, receipts, personal notes. Kept out of the way during service.",
      priority: 90,
      triage_rules: [
        { match: "subject_or_body_contains", any: ["newsletter","unsubscribe","receipt"] },
        { assign: { priority: 5, category: "personal", suggested_action: "no_action" } },
      ],
    },
  ],
  menu_skeleton: [],
  common_suppliers: [],
  pos_defaults: {
    provider: "none",
    service_charge_pct: 0,
    default_vat_pct: 10,
    tables: 0,
  },
  chart_of_accounts: [
    { code: "700", label: "Ventas — food",     type: "revenue" },
    { code: "705", label: "Ventas — beverage", type: "revenue" },
    { code: "600", label: "Compras — food",    type: "cogs"    },
    { code: "601", label: "Compras — beverage",type: "cogs"    },
    { code: "621", label: "Rent",              type: "opex"    },
    { code: "640", label: "Wages",             type: "opex"    },
    { code: "477", label: "IVA repercutido",   type: "tax"     },
  ],
  checklist_steps: [
    { key: "entity_created",       label: "Advisory entity created",      hint: "" },
    { key: "venue_configured",     label: "Venue configured",             hint: "Name, seats, ops window." },
    { key: "holded_connected",     label: "Holded connected",             hint: "" },
    { key: "pos_connected",        label: "POS connected",                hint: "" },
    { key: "bank_connected",       label: "Bank connected",               hint: "" },
    { key: "assistant_configured", label: "Assistant configured",         hint: "" },
    { key: "channels_connected",   label: "Channels connected",           hint: "" },
    { key: "team_invited",         label: "Team seats invited",           hint: "" },
    { key: "trained",              label: "Owner-operator trained",       hint: "" },
  ],
};

export const ADVISORY_TEMPLATES: AdvisoryTemplateSeed[] = [BISTROT_DU_MONDE, CALA_BOIX, BLANK];

export function findTemplate(key: string): AdvisoryTemplateSeed | null {
  return ADVISORY_TEMPLATES.find((t) => t.key === key) || null;
}
