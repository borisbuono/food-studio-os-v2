import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";
import OnboardWizardClient from "./OnboardWizardClient";

export const dynamic = "force-dynamic";

// Six-step onboarding wizard for the Assistant Layer.
// Configures a new entity — either one of the internal group (IFL/BM/BBH)
// or a fresh advisory client (creates ADV-<slug>). The wizard is prose-
// driven, editorial in tone, no bullet lists in the surface copy.
export default async function AssistantOnboardPage(props: {
  searchParams: { entity?: string };
}) {
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const uid = u.user?.id || null;
  if (!uid) return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <p className="font-mono text-[10px] uppercase tracking-wide text-clay">sign in to run the wizard</p>
    </main>
  );

  const [tiersRes, existingRes, advRes] = await Promise.all([
    sb.from("assistant_billing_tiers").select("name,monthly_action_cap,monthly_cost_cap_eur,features").order("monthly_cost_cap_eur", { ascending: true }),
    sb.from("assistant_config").select("entity_code,voice_profile"),
    sb.from("assistant_advisory_clients").select("entity_code,name,city,country").eq("is_active", true).order("name"),
  ]);
  const tiers = tiersRes.data || [];
  const configuredCodes = new Set((existingRes.data || []).map((r: any) => r.entity_code));
  const advClients = advRes.data || [];
  const deepEntity = (props.searchParams?.entity || "").toUpperCase();

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <Link href="/administrate/settings/assistant" className="font-mono text-[10px] uppercase tracking-wide text-clay">
        ← back to Assistant settings
      </Link>
      <p className="mt-6 font-mono text-[10px] uppercase tracking-wide text-clay">The Brain · onboarding</p>
      <h1 className="mt-2 font-serif text-[34px] leading-[1.05] text-ink">Bring a new profile online.</h1>
      <p className="mt-3 font-serif italic text-[15px] text-ink-soft">
        Six short steps. We shape the voice first, then the hours, then the rules that decide which mail matters and
        which one waits. At the end the Assistant writes a welcome brief in that new voice — the way a good hire
        introduces themselves on Monday.
      </p>

      <OnboardWizardClient
        deepEntity={deepEntity}
        configuredCodes={Array.from(configuredCodes)}
        advClients={advClients as any[]}
        tiers={tiers as any[]}
      />
    </main>
  );
}
