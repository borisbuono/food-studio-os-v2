import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";
import { serverEntity } from "@/lib/serverVenue";
import { EntityKey } from "@/lib/entities";
import MasterTodoBoard from "@/components/MasterTodoBoard";

export const dynamic = "force-dynamic";

const ENTITY_CODE: Record<EntityKey, string> = { holdings: "BBH", bistro_mondo: "BM", taller: "IFL" };

// /administrate/master-todo — the OS-native Master_ToDo surface.
// Mirrors Boris's Cowork-side PA orchestrator list. Ranks by impact_score
// so the highest-leverage move sits at the top.
export default async function MasterTodoPage() {
  const supabase = supabaseServer();
  const entity = serverEntity();
  const ec = ENTITY_CODE[entity] || "IFL";
  const { data: u } = await supabase.auth.getUser();

  // Read: same-entity + cross-entity (null entity_code).
  const [openRes, doneRes, profilesRes] = await Promise.all([
    supabase.from("master_todos").select("*").not("status", "in", "(completed,deferred)").order("impact_score", { ascending: false }).limit(200),
    supabase.from("master_todos").select("*").in("status", ["completed","deferred"]).order("updated_at", { ascending: false }).limit(30),
    supabase.from("profiles").select("id,name").limit(200),
  ]);

  const open = (openRes.data || []).filter((t: any) => !t.entity_code || t.entity_code === ec);
  const done = (doneRes.data || []).filter((t: any) => !t.entity_code || t.entity_code === ec);
  const profiles = profilesRes.data || [];

  return (
    <main className="mx-auto max-w-3xl lg:max-w-5xl px-6 py-10">
      <Link href="/administrate" className="font-mono text-[10px] uppercase tracking-wide text-clay">← administrate</Link>
      <p className="mt-6 font-mono text-[10px] uppercase tracking-wide" style={{ color: "var(--accent)" }}>Master ToDo · {ec}</p>
      <h1 className="mt-2 font-serif text-4xl leading-tight text-ink">What&apos;s on your plate.</h1>
      <p className="mt-2 font-serif italic text-[15px] text-ink-soft">
        Everything the PA is holding for you — ranked by leverage on your day.
      </p>

      <MasterTodoBoard
        entity={ec}
        open={open}
        done={done}
        profiles={profiles}
        me={u.user?.id || null}
      />
    </main>
  );
}
