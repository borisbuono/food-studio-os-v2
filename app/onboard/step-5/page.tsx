// /onboard/step-5 — land.
//
// Confirmation screen. Submitting the form marks the wizard complete,
// sets fs_entity to the new house and redirects to /h/<slug>.

import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabaseServer";
import { readOnboardingState } from "@/lib/onboarding";
import { OnboardShell, primaryBtn, secondaryBtn, labelCls } from "@/components/OnboardShell";
import { completeOnboardingAction } from "../actions";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function OnboardStep5() {
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) redirect("/onboard/step-1");
  const state = await readOnboardingState();
  if (!state.entity_id || !state.slug) redirect("/onboard/step-3");

  const invitedCount = (state.invited || []).length;

  return (
    <OnboardShell
      step={5}
      eyebrow="Ready"
      title={`${state.house?.trading_name || "Your house"} is set up.`}
      sub="From here on, the app takes over — recipes, service, invoices, the daily loop. Empty until you start feeding it. That's the point."
    >
      <dl className="grid grid-cols-1 gap-3 border-y border-black/10 py-5">
        <div className="flex items-center justify-between">
          <dt className={labelCls}>Country</dt>
          <dd className="font-sans text-[14px] text-ink">{state.house?.country_code || "ES"}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className={labelCls}>VAT (standard / food)</dt>
          <dd className="font-sans text-[14px] text-ink">
            {state.fiscal?.vat_regime?.standard ?? 21}% · {state.fiscal?.vat_regime?.reduced_food ?? 10}%
          </dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className={labelCls}>Currency · timezone</dt>
          <dd className="font-sans text-[14px] text-ink">
            {state.fiscal?.currency_code || "EUR"} · {state.fiscal?.timezone || "Europe/Madrid"}
          </dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className={labelCls}>Team invites sent</dt>
          <dd className="font-sans text-[14px] text-ink">{invitedCount}</dd>
        </div>
      </dl>

      <form action={completeOnboardingAction} className="mt-8 flex items-center gap-3">
        <Link href="/onboard/step-4" className={secondaryBtn}>Back</Link>
        <button className={primaryBtn + " flex-1"}>
          Open {state.house?.trading_name || "your house"} →
        </button>
      </form>

      <p className="mt-6 font-mono text-[10px] uppercase tracking-wide text-clay">
        You'll land on <span className="lowercase">/h/{state.slug}</span> — bookmark it.
      </p>
    </OnboardShell>
  );
}
