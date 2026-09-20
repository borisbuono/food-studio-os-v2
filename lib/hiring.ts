// lib/hiring.ts — shared helpers for the HR funnel.
//
// The core primitive is renderJobPost: given an opening + channel it
// returns a plain-text message ready for Boris to paste-and-send. We
// never auto-send WhatsApp / Telegram / Instagram (Boris memory rule).

export type JobOpening = {
  id: string;
  entity_id: string;
  title: string;
  role: string | null;
  station: string | null;
  description: string | null;
  hours_per_week: number | null;
  hourly_rate_eur: number | null;
  start_date: string | null;
  languages_required: string[] | null;
  status: string;
};

export const CANDIDATE_STATUSES = [
  "new",
  "screening",
  "interview",
  "trial",
  "offer",
  "hired",
  "rejected",
  "withdrew",
] as const;
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];

export const ACTIVE_CANDIDATE_STATUSES: CandidateStatus[] = [
  "new",
  "screening",
  "interview",
  "trial",
  "offer",
];

// Reaching hired/offer requires a manager (enforced in API + RLS-ish check).
export const MANAGER_ONLY_STATUS_TARGETS = new Set<CandidateStatus>(["hired", "offer"]);

export const OPENING_STATUSES = ["draft", "open", "paused", "closed", "filled"] as const;

export const POST_CHANNELS = [
  "whatsapp",
  "telegram",
  "instagram",
  "website",
  "portal",
  "internal",
] as const;
export type PostChannel = (typeof POST_CHANNELS)[number];

const HOUSE_LABEL: Record<string, string> = {
  "387f1045-0340-4029-a1e4-28b15c372680": "Bistro Mondo (Sant Joan)",
  "daec58d9-44a2-4c24-9183-2a87219093fb": "Taller Sa Penya (Ibiza town)",
};

export function houseLabelForEntity(entity_id: string): string {
  return HOUSE_LABEL[entity_id] || "our kitchen";
}

// renderJobPost — plain-text draft, channel-flavoured. This is intentionally
// hand-editable. Boris tweaks per group before pasting.
export function renderJobPost(
  opening: JobOpening,
  channel: PostChannel,
  opts: { customMessage?: string; entityLabel?: string } = {}
): string {
  if (opts.customMessage && opts.customMessage.trim()) return opts.customMessage.trim();

  const where = opts.entityLabel || houseLabelForEntity(opening.entity_id);
  const rate = opening.hourly_rate_eur != null ? `€${opening.hourly_rate_eur}/h` : null;
  const hrs = opening.hours_per_week != null ? `${opening.hours_per_week}h/week` : null;
  const start = opening.start_date ? `start ${opening.start_date}` : null;
  const langs =
    opening.languages_required && opening.languages_required.length
      ? `languages: ${opening.languages_required.join(", ")}`
      : null;

  const bullets = [hrs, rate, start, langs].filter(Boolean).join(" · ");

  if (channel === "whatsapp" || channel === "telegram") {
    return [
      `We're hiring at ${where}.`,
      `Role: ${opening.title}${opening.station ? ` — ${opening.station}` : ""}`,
      bullets ? bullets : null,
      opening.description ? `\n${opening.description.trim()}` : null,
      "\nInterested? Reply here with your name and a bit of experience.",
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (channel === "instagram") {
    return [
      `${where} — hiring 🍽`,
      `${opening.title}${opening.station ? ` (${opening.station})` : ""}`,
      bullets,
      opening.description ? opening.description.trim() : null,
      "DM us to apply.",
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  if (channel === "website" || channel === "portal") {
    return [
      `${opening.title} — ${where}`,
      "",
      bullets,
      "",
      opening.description ? opening.description.trim() : "",
      "",
      "To apply, contact us with your CV and a note on your experience.",
    ].join("\n");
  }

  // internal / fallback
  return [
    `Opening: ${opening.title}`,
    `Venue: ${where}`,
    bullets,
    opening.description ? `\n${opening.description.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
