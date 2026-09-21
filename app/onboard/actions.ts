"use server";

// app/onboard/actions.ts — server actions for the /onboard wizard.
//
// Every step form posts to one of these. Each returns a redirect so the
// browser lands on the next step (or an error state via query param).

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabaseServer";
import {
  writeOnboardingState,
  readOnboardingState,
  type HouseDraft,
  type FiscalDraft,
  type InviteRole,
} from "@/lib/onboarding";
import { countryProfile, slugify, type CountryCode } from "@/lib/countries";
import { cookies, headers } from "next/headers";
import { langForCountry } from "@/lib/i18nDict";
import { sendInviteEmail } from "@/lib/email/invite";

// ---- Step 2 — create the house ------------------------------------------
export async function saveHouseAction(formData: FormData) {
  const trading_name = (formData.get("trading_name") || "").toString().trim();
  const legal_name   = (formData.get("legal_name")   || "").toString().trim();
  const country_code = ((formData.get("country_code") || "ES").toString().toUpperCase()) as CountryCode;
  const tax_id       = (formData.get("tax_id")       || "").toString().trim();
  const address_line1= (formData.get("address_line1")|| "").toString().trim();
  const postal_code  = (formData.get("postal_code")  || "").toString().trim();
  const city         = (formData.get("city")         || "").toString().trim();
  const website_url  = (formData.get("website_url")  || "").toString().trim();

  if (!trading_name) redirect("/onboard/step-2?e=trading_name");

  const house: HouseDraft = {
    trading_name, legal_name, country_code, tax_id,
    address_line1, postal_code, city, website_url,
  };
  // Pre-fill fiscal from country as the default (operator can edit in step 3).
  const cp = countryProfile(country_code);
  const fiscalDefaults: FiscalDraft = {
    vat_regime: cp.vat,
    fiscal_year_end: "12-31",
    currency_code: cp.currency_code,
    timezone: cp.timezone,
  };

  // Runway d2 (2026-09-20 — Amsterdam launch): seed fs_lang from country if
  // the visitor hasn't set one yet. NL → nl for the Dutch operator; ES → es
  // for Ibiza; else en. Never overrides an existing pick.
  try {
    const jar = cookies();
    if (!jar.get("fs_lang")?.value) {
      jar.set("fs_lang", langForCountry(country_code), {
        path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365,
      });
    }
  } catch { /* read-only render — non-fatal */ }

  await writeOnboardingState({ step: 3, house, fiscal: fiscalDefaults });
  redirect("/onboard/step-3");
}

// ---- Step 3 — fiscal profile, then create the entity row -----------------
export async function saveFiscalAndCreateEntityAction(formData: FormData) {
  const state = await readOnboardingState();
  if (!state.house?.trading_name) redirect("/onboard/step-2?e=missing_house");

  const standard     = Number(formData.get("vat_standard") || 0);
  const reduced_food = Number(formData.get("vat_reduced_food") || 0);
  const zero         = Number(formData.get("vat_zero") || 0);
  const fiscal_year_end = (formData.get("fiscal_year_end") || "12-31").toString().slice(0, 5);
  const currency_code   = (formData.get("currency_code") || "EUR").toString().toUpperCase().slice(0, 3);
  const timezone        = (formData.get("timezone") || "Europe/Madrid").toString();

  const fiscal: FiscalDraft = {
    vat_regime: { standard, reduced_food, zero },
    fiscal_year_end, currency_code, timezone,
  };

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const uid = u.user?.id;
  if (!uid) redirect("/onboard/step-1?e=auth");

  const house = state.house!;
  const cp = countryProfile(house.country_code);
  const now = new Date().toISOString();

  // Pick a slug that doesn't collide with an existing entity.
  const baseSlug = slugify(house.trading_name || "house");
  let slug = baseSlug;
  for (let i = 2; i < 20; i++) {
    const { data: exists } = await sb.from("entities").select("id").eq("slug", slug).maybeSingle();
    if (!exists) break;
    slug = `${baseSlug}-${i}`;
  }

  const insertRow: Record<string, any> = {
    name: house.trading_name,
    slug,
    // Must match entities_entity_type_check (holding_company / operating_venue /
    // advisory_client / partner / landlord). "house" broke every self-serve
    // signup — stress test 2026-09-21, blocker #1.
    entity_type: "operating_venue",
    legal_name: house.legal_name || null,
    country: cp.name,                   // legacy column, keep populated
    country_code: house.country_code || "ES",
    city: house.city || null,
    tax_id: house.tax_id || null,
    address_line1: house.address_line1 || null,
    postal_code: house.postal_code || null,
    website_url: house.website_url || null,
    currency_code, timezone,
    vat_regime: fiscal.vat_regime,
    fiscal_year_end,
    is_active: true,
    onboarded_at: now,
    onboarded_by: uid,
  };
  const { data: ent, error } = await sb.from("entities").insert(insertRow).select("id, slug").single();
  if (error || !ent) {
    // Persist fiscal draft even on failure so the operator can retry.
    await writeOnboardingState({ fiscal });
    redirect("/onboard/step-3?e=" + encodeURIComponent(error?.message || "insert_failed"));
  }

  // Membership row so the operator can enter their new house.
  // team_members has separate auth_user_id → id linkage; look for the row and
  // create it if missing. Kept forgiving: if either write fails, the wizard
  // still lets them continue — the operator can be granted access manually.
  try {
    let personId: string | null = null;
    // .limit(1), not .maybeSingle(): a user can own several team_members
    // rows and maybeSingle() errors on >1, which silently created a duplicate.
    const { data: tmRows } = await sb
      .from("team_members")
      .select("id")
      .eq("auth_user_id", uid)
      .limit(1);
    const existingTm = (tmRows || [])[0] as { id?: string } | undefined;
    if (existingTm?.id) {
      personId = existingTm.id as string;
    } else {
      const email = u.user?.email || null;
      const displayName = (u.user?.user_metadata as any)?.full_name || email || "Owner";
      const { data: newTm } = await sb
        .from("team_members")
        // default_role is NOT NULL with no default — omitting it made this
        // insert fail silently inside the catch below, so the owner never got
        // a membership (found 2026-09-21 replaying the wizard on live DB).
        .insert({ auth_user_id: uid, name: displayName, email, status: "active", default_role: "owner" })
        .select("id")
        .single();
      personId = newTm?.id ?? null;
    }
    if (personId && ent.id) {
      await sb
        .from("memberships")
        .upsert(
          {
            person_id: personId,
            entity_id: ent.id,
            role: "owner",
            area: "admin",
            status: "active",
            is_default: true,
          },
          { onConflict: "person_id,entity_id" },
        );
    }
  } catch { /* best-effort */ }

  // profiles.language defaults to 'en'; carry the country language over
  // unless the user already picked one (stress test 2026-09-21).
  try {
    await sb.from("profiles").update({ language: langForCountry(house.country_code) }).eq("id", uid).eq("language", "en");
  } catch { /* non-fatal */ }

  await writeOnboardingState({
    step: 4,
    fiscal,
    entity_id: ent.id,
    slug: ent.slug || slug,
  });
  revalidatePath("/");
  redirect("/onboard/step-4");
}

// ---- Step 4 — invite team ------------------------------------------------
export async function inviteTeammateAction(formData: FormData) {
  const state = await readOnboardingState();
  if (!state.entity_id) redirect("/onboard/step-3?e=missing_entity");

  const email = (formData.get("email") || "").toString().trim().toLowerCase();
  const role  = (formData.get("role")  || "manager").toString() as InviteRole;
  if (!email || !/@/.test(email)) redirect("/onboard/step-4?e=email");

  // POST through the internal API so we exercise the same code path a later
  // "invite from settings" surface will use.
  const sb = supabaseServer();
  const { data: me } = await sb.auth.getUser();
  const token = cryptoRandomToken();
  const { error: tokErr } = await sb
    .from("pending_invites")
    .insert({
      entity_id: state.entity_id,
      email,
      role,
      token,
      invited_by: me.user?.id ?? null,
    });
  if (tokErr) redirect("/onboard/step-4?e=" + encodeURIComponent(tokErr.message));

  // Transactional email (stress test 2026-09-21, blocker #4). Soft-fail: the
  // step-4 list always shows a copyable accept link as the fallback.
  let emailed = false;
  try {
    const h = headers();
    const host = h.get("x-forwarded-host") || h.get("host");
    const proto = h.get("x-forwarded-proto") || "https";
    const meta: any = me.user?.user_metadata || {};
    const r = await sendInviteEmail({
      email, role, token,
      houseName: state.house?.trading_name || "your house",
      inviterName: meta.full_name || meta.name || null,
      origin: host ? `${proto}://${host}` : null,
    });
    emailed = r.emailed;
  } catch { /* soft-fail */ }

  const invited = [...(state.invited || []), { email, role }];
  await writeOnboardingState({ invited });
  redirect(`/onboard/step-4?ok=1&sent=${emailed ? "1" : "0"}`);
}

// ---- Step 5 — land -------------------------------------------------------
export async function completeOnboardingAction() {
  const state = await readOnboardingState();
  if (!state.slug) redirect("/onboard/step-3?e=missing_entity");
  const completedAt = new Date().toISOString();
  await writeOnboardingState({ step: 5, completed_at: completedAt });

  // Entity-level completion (stress test 2026-09-21): external checks read
  // entities.onboarding_progress, not the per-user wizard state.
  if (state.entity_id) {
    try {
      const sb = supabaseServer();
      const { data: ent } = await sb.from("entities").select("onboarding_progress").eq("id", state.entity_id).maybeSingle();
      const prev: any = (ent as any)?.onboarding_progress || {};
      const steps = Array.from(new Set([...(Array.isArray(prev.steps_completed) ? prev.steps_completed : []), 1, 2, 3, 4, 5]));
      await sb.from("entities").update({
        onboarding_progress: {
          ...prev,
          started_at: prev.started_at || (state as any).started_at || completedAt,
          completed_at: completedAt,
          current_step: 5,
          steps_completed: steps,
        },
      }).eq("id", state.entity_id);
    } catch { /* non-fatal — wizard state already records completion */ }
  }

  // Set fs_entity cookie so the app shell paints the right house on landing.
  const { cookies } = await import("next/headers");
  cookies().set({
    name: "fs_entity",
    value: state.entity_id || "",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });

  redirect(`/h/${state.slug}`);
}

// Cheap token — 32 hex chars from Math.random is fine for a magic-link
// nonce that lives 30 days; the security bar is "email possession", not
// unpredictability against a motivated attacker.
function cryptoRandomToken(): string {
  const arr = new Uint8Array(24);
  if (typeof crypto !== "undefined" && (crypto as any).getRandomValues) {
    (crypto as any).getRandomValues(arr);
  } else {
    for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}
