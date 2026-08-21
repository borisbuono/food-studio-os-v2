import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";
import { serverEntity } from "@/lib/serverVenue";
import { EntityKey } from "@/lib/entities";
import MemoryClient from "./MemoryClient";

export const dynamic = "force-dynamic";

const ENTITY_CODE: Record<EntityKey, "IFL" | "BM" | "BBH"> = {
  holdings: "BBH", bistro_mondo: "BM", taller: "IFL",
};

// Assistant Polish #3 — memory curation surface.
// Lists what the Assistant has learned about the operator (facts pulled
// out of conversations by lib/assistant/memory/extractor.ts). Each row
// can be confirmed, edited, or retired. Empty state points the operator
// back to using the FAB.
export default async function AssistantMemoryPage() {
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const uid = u.user?.id || null;
  if (!uid) return (
    <main className="mx-auto max-w-3xl lg:max-w-5xl px-6 py-12">
      <p className="font-mono text-[10px] uppercase tracking-wide text-clay">sign in to view</p>
    </main>
  );

  const entity = serverEntity();
  const ec = ENTITY_CODE[entity];

  // Rows for the current entity + rows with no entity_code (legacy / global).
  const { data: rows } = await sb.from("assistant_memory")
    .select("id,fact,subject,predicate,object,kind,tags,entity_code,scope,confidence,confirmed_at,created_at,source_conversation_id")
    .eq("user_id", uid)
    .is("retired_at", null)
    .or("entity_code.eq." + ec + ",entity_code.is.null")
    .order("created_at", { ascending: false })
    .limit(500);

  // How many extractions have run for this operator recently — used in the
  // empty state so we can tell "no learning yet" from "extractor never ran".
  const { data: runs } = await sb.from("assistant_memory_extractions")
    .select("id,facts_inserted,created_at")
    .eq("user_id", uid)
    .order("created_at", { ascending: false })
    .limit(20);

  return (
    <main className="mx-auto max-w-3xl lg:max-w-5xl px-6 py-12">
      <Link href="/administrate/settings/assistant" className="font-mono text-[10px] uppercase tracking-wide text-clay">← Assistant</Link>
      <p className="mt-6 font-mono text-[10px] uppercase tracking-wide text-clay">Memory · {ec}</p>
      <h1 className="mt-2 font-serif text-[34px] leading-[1.05] text-ink">What the Assistant knows</h1>
      <p className="mt-3 font-serif italic text-[15px] text-ink-soft">
        A quiet index of atomic facts the Assistant has learned. Some were told to it directly, others distilled from
        recent conversations. Confirm the ones that are true, edit the ones that are close, retire the ones that are wrong.
      </p>

      <MemoryClient
        entityCode={ec}
        initialRows={(rows || []) as any[]}
        recentRuns={(runs || []) as any[]}
      />
    </main>
  );
}
