// /onboard/step-3 — fiscal profile.
//
// VAT rates and currency come pre-filled from the country picked in step 2.
// Fiscal year end defaults to 31 Dec. Submit writes the entity row.

import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabaseServer";
import { readOnboardingState } from "@/lib/onboarding";
import { OnboardShell, inputCls, labelCls, primaryBtn, secondaryBtn } from "@/components/OnboardShell";
import { countryProfile } from "@/lib/countries";
import { saveFiscalAndCreateEntityAction } from "../actions";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function OnboardStep3({ searchParams }: { searchParams?: { e?: string } }) {
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) redirect("/onboard/step-1");
  const state = await readOnboardingState();
  if (!state.house?.trading_name) redirect("/onboard/step-2");

  const cp = countryProfile(state.house.country_code);
  const f = state.fiscal || {};
  const vat = f.vat_regime || cp.vat;
  const err = searchParams?.e || null;

  return (
    <OnboardShell
      step={3}
      eyebrow={state.house.trading_name}
      title="How does the tax year run?"
      sub="Pre-filled from the country you chose. Only edit if your accountant already told you to."
    >
      <form action={saveFiscalAndCreateEntityAction} className="space-y-6">
        <div>
          <p className={labelCls}>VAT rates</p>
          <div className="mt-2 grid grid-cols-3 gap-3">
            <label className="block">
              <span className="font-sans text-[12px] text-ink-soft">Standard %</span>
              <input name="vat_standard" type="number" step="0.5" defaultValue={vat.standard} className={inputCls} />
            </label>
            <label className="block">
              <span className="font-sans text-[12px] text-ink-soft">Food %</span>
              <input name="vat_reduced_food" type="number" step="0.5" defaultValue={vat.reduced_food} className={inputCls} />
            </label>
            <label className="block">
              <span className="font-sans text-[12px] text-ink-soft">Zero %</span>
              <input name="vat_zero" type="number" step="0.5" defaultValue={vat.zero} className={inputCls} />
            </label>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={labelCls}>Fiscal year end</span>
            <input name="fiscal_year_end" defaultValue={f.fiscal_year_end || "12-31"} pattern="\d{2}-\d{2}" className={inputCls} placeholder="MM-DD" />
            <span className="mt-1 block font-sans text-[12px] text-ink-soft">Default 31 December.</span>
          </label>
          <label className="block">
            <span className={labelCls}>Currency</span>
            <input name="currency_code" defaultValue={f.currency_code || cp.currency_code} maxLength={3} className={inputCls + " uppercase"} />
          </label>
        </div>

        <label className="block">
          <span className={labelCls}>Timezone</span>
          <input name="timezone" defaultValue={f.timezone || cp.timezone} className={inputCls} />
        </label>

        {err ? <p className="font-mono text-[11px] text-tomato">{err}</p> : null}

        <div className="flex items-center gap-3">
          <Link href="/onboard/step-2" className={secondaryBtn}>Back</Link>
          <button className={primaryBtn + " flex-1"}>Create the house →</button>
        </div>
      </form>
    </OnboardShell>
  );
}
