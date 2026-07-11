import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";
import { serverEntity } from "@/lib/serverVenue";
import { EntityKey } from "@/lib/entities";
import AgentCharterBoard from "@/components/AgentCharterBoard";

export const dynamic = "force-dynamic";

const ENTITY_CODE: Record<EntityKey, string> = { holdings: "BBH", bistro_mondo: "BM", taller: "IFL", utopia: "IFL" };

// /administrate/agent-charters — the OS-native Agent Task Charter surface.
// Every agent spawned from the OS gets a charter row before it runs.
export default async function AgentChartersPage() {
  const supabase = supabaseServer();
  const entity = serverEntity();
  const ec = ENTITY_CODE[entity] || "IFL";

  const { data: charters } = await supabase
    .from("agent_charters")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);

  const scoped = (charters || []).filter((c: any) => !c.entity_code || c.entity_code === ec);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Link href="/administrate" className="font-mono text-[10px] uppercase tracking-wide text-clay">← administrate</Link>
      <p className="mt-6 font-mono text-[10px] uppercase tracking-wide" style={{ color: "var(--accent)" }}>Agent charters · {ec}</p>
      <h1 className="mt-2 font-serif text-4xl leading-tight text-ink">Scope every agent-task upfront.</h1>
      <p className="mt-2 font-serif italic text-[15px] text-ink-soft">
        The charter is the contract. Objective, scope, constraints, success criteria, deliverables — before the agent runs.
      </p>

      <AgentCharterBoard entity={ec} charters={scoped} />
    </main>
  );
}
