// lib/onboarding.ts — shared shape + persistence for the /onboard wizard.
//
// Every step reads and writes profiles.onboarding_state (jsonb). Refresh
// safe: reload the page mid-wizard and you land where you left off.

import { supabaseServer } from "@/lib/supabaseServer";
import type { VatRegime } from "@/lib/countries";

export type OnboardingStep = 1 | 2 | 3 | 4 | 5;

export type HouseDraft = {
  trading_name?: string;
  legal_name?: string;
  country_code?: string;
  tax_id?: string;
  address_line1?: string;
  postal_code?: string;
  city?: string;
  website_url?: string;
};

export type FiscalDraft = {
  vat_regime?: VatRegime;
  fiscal_year_end?: string;   // MM-DD
  currency_code?: string;
  timezone?: string;
};

export type TeamInviteDraft = {
  email: string;
  role: string;
};

export type OnboardingState = {
  step: OnboardingStep;
  house?: HouseDraft;
  fiscal?: FiscalDraft;
  invited?: TeamInviteDraft[];
  entity_id?: string;   // set once the house has been created (end of step 3)
  slug?: string;
  completed_at?: string;
};

const EMPTY: OnboardingState = { step: 1 };

// Read the current user's wizard state. Returns EMPTY if signed out or if
// the profile row doesn't exist yet.
export async function readOnboardingState(): Promise<OnboardingState> {
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return EMPTY;
  const { data } = await sb
    .from("profiles")
    .select("onboarding_state")
    .eq("id", uid)
    .maybeSingle();
  const s = (data?.onboarding_state as OnboardingState | null) || null;
  if (!s) return EMPTY;
  return { ...EMPTY, ...s };
}

// Merge a patch into onboarding_state. Idempotent, jsonb deep-merge at the
// top-level keys (house / fiscal / invited get replaced wholesale — the
// forms always send the whole slice).
export async function writeOnboardingState(patch: Partial<OnboardingState>): Promise<OnboardingState> {
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return EMPTY;

  const current = await readOnboardingState();
  const next: OnboardingState = { ...current, ...patch };

  // Ensure a profiles row exists (upsert on id).
  await sb
    .from("profiles")
    .upsert({ id: uid, onboarding_state: next }, { onConflict: "id" });

  return next;
}

// Role vocab for step 4 — matches lib/team/onboarding.ts roles but tightened
// to the five the wizard offers.
export type InviteRole = "owner" | "manager" | "chef" | "waiter" | "office";

export const INVITE_ROLES: InviteRole[] = ["owner", "manager", "chef", "waiter", "office"];

export const INVITE_ROLE_LABEL: Record<InviteRole, string> = {
  owner: "Owner",
  manager: "Manager",
  chef: "Chef",
  waiter: "Waiter",
  office: "Office",
};

// role → team_members.area, so the memberships row lands in the right room.
export const INVITE_ROLE_AREA: Record<InviteRole, "boh" | "foh" | "admin"> = {
  owner: "admin",
  manager: "admin",
  chef: "boh",
  waiter: "foh",
  office: "admin",
};
