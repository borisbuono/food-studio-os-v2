// /onboard/step-2 — name the house.
//
// Server component. Form posts to saveHouseAction which persists the
// draft into profiles.onboarding_state and redirects to step 3.

import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabaseServer";
import { readOnboardingState } from "@/lib/onboarding";
import { OnboardShell, inputCls, labelCls, primaryBtn } from "@/components/OnboardShell";
import { COUNTRY_ORDER, COUNTRY_PROFILES, countryProfile } from "@/lib/countries";
import { saveHouseAction } from "../actions";
import Step2CountrySelect from "./Step2CountrySelect";

export const dynamic = "force-dynamic";

export default async function OnboardStep2({ searchParams }: { searchParams?: { e?: string } }) {
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) redirect("/onboard/step-1");
  const state = await readOnboardingState();
  const h = state.house || {};
  const country = (h.country_code || "ES").toUpperCase();
  const cp = countryProfile(country);
  const err = searchParams?.e || null;

  return (
    <OnboardShell
      step={2}
      eyebrow="The house"
      title="Name your house."
      sub="Trading name is what guests see. The legal side is what the accountant sees. Both can change later."
    >
      <form action={saveHouseAction} className="space-y-5">
        <label className="block">
          <span className={labelCls}>Trading name</span>
          <input name="trading_name" defaultValue={h.trading_name || ""} required className={inputCls} placeholder="e.g. Café Amsterdam" />
        </label>

        <label className="block">
          <span className={labelCls}>Legal name (optional)</span>
          <input name="legal_name" defaultValue={h.legal_name || ""} className={inputCls} placeholder="e.g. Café Amsterdam B.V." />
        </label>

        <div>
          <span className={labelCls}>Country</span>
          <Step2CountrySelect
            defaultValue={country}
            options={COUNTRY_ORDER.map((c) => ({ value: c, label: COUNTRY_PROFILES[c].name }))}
          />
          <p className="mt-1 font-sans text-[12px] text-ink-soft">
            Sets VAT rates, timezone and the tax-ID label. All editable in the next step.
          </p>
        </div>

        <label className="block">
          <span className={labelCls}>{cp.tax_id_label}</span>
          <input name="tax_id" defaultValue={h.tax_id || ""} className={inputCls} placeholder={cp.tax_id_label} />
        </label>

        <label className="block">
          <span className={labelCls}>Address</span>
          <input name="address_line1" defaultValue={h.address_line1 || ""} className={inputCls} placeholder="Street and number" />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={labelCls}>Postcode</span>
            <input name="postal_code" defaultValue={h.postal_code || ""} className={inputCls} />
          </label>
          <label className="block">
            <span className={labelCls}>City</span>
            <input name="city" defaultValue={h.city || ""} className={inputCls} />
          </label>
        </div>

        <label className="block">
          <span className={labelCls}>Website (optional)</span>
          <input name="website_url" defaultValue={h.website_url || ""} className={inputCls} placeholder="https://…" />
        </label>

        {err ? <p className="font-mono text-[11px] text-tomato">{err === "trading_name" ? "Trading name is required." : err}</p> : null}

        <button className={primaryBtn + " w-full"}>Continue →</button>
      </form>
    </OnboardShell>
  );
}
