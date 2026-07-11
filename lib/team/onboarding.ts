// Team onboarding helpers — the small server-agnostic surface shared between
// the wizard page, /team/join, the training / first-week screens, and the
// server route that finalizes an invitation.
//
// Kept intentionally thin: role labels, the step list, and pure helpers.
// Actual reads/writes happen in the pages via supabaseBrowser / supabaseServer.

export type OnboardingRole =
  | "owner" | "manager" | "chef" | "foh" | "pastry" | "porter" | "host" | "other";

export const ONBOARDING_ROLES: OnboardingRole[] = [
  "owner", "manager", "chef", "foh", "pastry", "porter", "host", "other",
];

export const ROLE_LABEL: Record<OnboardingRole, string> = {
  owner: "Owner",
  manager: "Manager",
  chef: "Chef",
  foh: "Front of house",
  pastry: "Pastry",
  porter: "Porter",
  host: "Host",
  other: "Other",
};

export const ROLE_BLURB: Record<OnboardingRole, string> = {
  owner: "Sees everything — Office, the numbers, all venues.",
  manager: "Runs the venue day-to-day — schedule, ordering, close.",
  chef: "Owns the pass — recipes, prep, service.",
  foh: "Runs the floor — covers, service, guest moments.",
  pastry: "Owns the pastry section — bake plan, plating.",
  porter: "Cleaning, dishwash, deliveries, the base of the house.",
  host: "First greeting, bookings, seating.",
  other: "Custom role — set the fine-grained scope after joining.",
};

// Restaurant UUID → entity_code, so the wizard can write both sides in one go.
// Mirrors ENTITY_TO_RESTAURANT in lib/entities.ts — kept as a plain map so it
// can be used server-side without pulling the client-only entities module.
export const RESTAURANT_TO_ENTITY_CODE: Record<string, "IFL" | "BM" | "BBH"> = {
  "a0000000-0000-4000-8000-000000000001": "IFL",       // Utopia (launch sandbox — routes to IFL for finance)
  "fb4d008f-2d2a-4e0d-a525-6e0e36af0259": "BM",
  "ca83e06f-a24d-43d7-bce4-57ac341d190f": "IFL",
};

// The step list used by the pipeline view + the first-week / first-shift
// screens. Kept in source so the UI can render labels without a lookup table.
export type StepKey =
  | "profile_completed"
  | "photo_uploaded"
  | "documents_signed"
  | "system_walked"
  | "first_shift_scheduled"
  | "first_meal_briefed"
  | "team_introduced"
  | "pos_trained"
  | "clock_in_configured"
  | "buddy_assigned"
  | "first_solo_shift"
  | "week_review_meeting";

export const STEP_LABEL: Record<StepKey, string> = {
  profile_completed: "Profile completed",
  photo_uploaded: "Photo uploaded",
  documents_signed: "Documents signed",
  system_walked: "System walked",
  first_shift_scheduled: "First shift scheduled",
  first_meal_briefed: "First meal briefed",
  team_introduced: "Team introduced",
  pos_trained: "POS trained",
  clock_in_configured: "Clock-in configured",
  buddy_assigned: "Buddy assigned",
  first_solo_shift: "First solo shift",
  week_review_meeting: "Week-1 review meeting",
};

// The default weekly checklist. Each day → an ordered list of step_keys.
// Manager surface renders these buckets in order.
export const FIRST_WEEK: { day: string; label: string; steps: StepKey[] }[] = [
  { day: "Day 1", label: "Landing day",
    steps: ["buddy_assigned", "team_introduced", "system_walked", "clock_in_configured", "first_meal_briefed"] },
  { day: "Day 2–3", label: "Finding the rhythm",
    steps: ["pos_trained", "first_shift_scheduled"] },
  { day: "Day 4–5", label: "Standing on their own",
    steps: ["first_solo_shift"] },
  { day: "Day 6–7", label: "The first review",
    steps: ["week_review_meeting"] },
];

// Signup-time document acknowledgments.
export const REQUIRED_ACKS: { key: "handbook_ack" | "food_safety_ack" | "gdpr_ack"; label: string; blurb: string }[] = [
  { key: "handbook_ack",    label: "House rules",    blurb: "How we run — arrival, uniform, breaks, the standards we hold." },
  { key: "food_safety_ack", label: "Food safety",    blurb: "Allergens, HACCP flow, cross-contamination rules." },
  { key: "gdpr_ack",        label: "Privacy notice", blurb: "How your data is handled — payroll, schedule, photos." },
];

export type PipelineStatus = "invited" | "onboarding" | "active" | "expired" | "revoked";

// Given an invitation + its current step progress, resolve the pipeline bucket.
export function invitationStatus(inv: {
  accepted_at?: string | null;
  revoked_at?: string | null;
  expires_at?: string | null;
}, stepCount: number): PipelineStatus {
  if (inv.revoked_at) return "revoked";
  if (!inv.accepted_at) {
    if (inv.expires_at && new Date(inv.expires_at) < new Date()) return "expired";
    return "invited";
  }
  // Accepted — is the person still working through steps?
  if (stepCount < 6) return "onboarding";
  return "active";
}

// Signed public join URL — sits under /team/join?token=… — the token is generated
// server-side (default gen_random_uuid()) so this is just a URL builder.
export function joinUrl(origin: string, token: string): string {
  return `${origin.replace(/\/$/, "")}/team/join?token=${encodeURIComponent(token)}`;
}
