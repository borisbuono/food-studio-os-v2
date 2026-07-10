import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";
import { serverEntity } from "@/lib/serverVenue";
import { EntityKey } from "@/lib/entities";
import AssistantSettingsClient from "./AssistantSettingsClient";

export const dynamic = "force-dynamic";

const ENTITY_CODE: Record<EntityKey, "IFL" | "BM" | "BBH"> = {
  holdings: "BBH", bistro_mondo: "BM", taller: "IFL", utopia: "IFL",
};

// Assistant Layer Sprint 5 — the config-as-data surface.
// Voice + personality, working hours, playbooks, channels. Every write goes
// through /api/assistant/{config,playbooks,channels} so the DB stays the
// single source of truth. The Chef FAB (and the brief generator, and any
// future email/WhatsApp triage) reads assistant_config live on every call.
export default async function AssistantSettingsPage() {
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const uid = u.user?.id || null;
  if (!uid) return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <p className="font-mono text-[10px] uppercase tracking-wide text-clay">sign in to view</p>
    </main>
  );

  const entity = serverEntity();
  const ec = ENTITY_CODE[entity];

  const [{ data: config }, { data: playbooks }, { data: channels }] = await Promise.all([
    sb.from("assistant_config").select("*").eq("entity_code", ec).maybeSingle(),
    sb.from("assistant_playbooks").select("*").eq("entity_code", ec).order("priority", { ascending: true }),
    sb.from("assistant_channels").select("*").eq("user_id", uid).is("revoked_at", null).order("created_at", { ascending: false }),
  ]);

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <Link href="/administrate/settings" className="font-mono text-[10px] uppercase tracking-wide text-clay">← settings</Link>
      <p className="mt-6 font-mono text-[10px] uppercase tracking-wide text-clay">Assistant · {ec}</p>
      <h1 className="mt-2 font-serif text-[34px] leading-[1.05] text-ink">The Brain</h1>
      <p className="mt-2 font-serif italic text-[15px] text-ink-soft">
        The Assistant Layer configuration for this entity. Voice, hours, playbooks, and your personal channels.
      </p>
      <p className="mt-4 font-mono text-[10px] uppercase tracking-wide">
        <Link href="/administrate/settings/assistant/onboard" className="text-ink border-b border-ink/40 pb-0.5">bring a new profile online</Link>
        <span className="text-clay mx-2">·</span>
        <Link href="/administrate/settings/assistant/onboard?entity=NEW" className="text-ink border-b border-ink/40 pb-0.5">add advisory client</Link>
      </p>

      <section className="mt-6 border-t border-black/10 pt-4">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Learning loop</p>
        <p className="mt-2 font-serif italic text-[14px] text-ink-soft">
          What the Assistant is learning about you and how much it&apos;s doing on your behalf. Curate memory, audit every action.
        </p>
        <p className="mt-3 font-mono text-[10px] uppercase tracking-wide">
          <Link href="/administrate/settings/assistant/memory" className="text-ink border-b border-ink/40 pb-0.5">what the assistant knows</Link>
          <span className="text-clay mx-2">·</span>
          <Link href="/administrate/settings/assistant/audit" className="text-ink border-b border-ink/40 pb-0.5">what the assistant did</Link>
        </p>
      </section>

      <AssistantSettingsClient
        entityCode={ec}
        initialConfig={config || null}
        initialPlaybooks={playbooks || []}
        initialChannels={channels || []}
      />
    </main>
  );
}
