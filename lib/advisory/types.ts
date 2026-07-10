// Advisory Sprint #1 — shared TypeScript types for the advisory-client
// productisation. Kept small so both server components and API routes can
// import without pulling in Supabase.

export type AdvisoryStatus = "prospect" | "onboarding" | "active" | "paused" | "churned";
export type AdvisoryTier   = "advisory" | "pro" | "enterprise";
export type AdvisorySeatRole = "owner" | "manager" | "staff" | "advisor_readonly";

export type AdvisoryClient = {
  id: string;
  entity_code: string;             // ADV-<slug>
  name: string;
  fiscal_name: string | null;
  cif: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  primary_advisor_user_id: string | null;
  status: AdvisoryStatus;
  tier: AdvisoryTier;
  notes: string | null;
  created_at: string;
  activated_at: string | null;
  paused_at: string | null;
  updated_at: string;
};

export type AdvisoryVenue = {
  id: string;
  advisory_client_id: string;
  name: string;
  brand: string | null;
  restaurant_id: string | null;
  city: string | null;
  country: string | null;
  operational_since: string | null;
  opens_at: string | null;
  seats: number | null;
  created_at: string;
  updated_at: string;
};

export type AdvisorySeat = {
  id: string;
  advisory_client_id: string;
  user_id: string | null;
  email: string;
  role: AdvisorySeatRole;
  invited_at: string;
  invited_by: string | null;
  accepted_at: string | null;
  revoked_at: string | null;
  invite_token: string | null;
};

export type AdvisoryClientOverview = AdvisoryClient & {
  venues_count: number;
  accepted_seats: number;
  pending_invites: number;
};

// Normalise a client name into an ADV-<slug> entity code — same rules as
// the Sprint 6 onboarding wizard so codes are stable across the surfaces.
export function slugifyToEntityCode(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 32) || "client";
  return ("ADV-" + slug).toUpperCase();
}
