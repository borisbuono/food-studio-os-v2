import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";
import { serverEntity } from "@/lib/serverVenue";
import { EntityKey, E_BM, E_TALLER, E_UTOPIA, E_HOLDINGS } from "@/lib/entities";
import AcademyBoard from "@/components/AcademyBoard";

export const dynamic = "force-dynamic";

const ENTITY_CODE: Record<EntityKey, string> = { [E_HOLDINGS]: "BBH", [E_BM]: "BM", [E_TALLER]: "IFL", [E_UTOPIA]: "UTOPIA", };

// /develop/academy — the Academy surface. Today's lesson at the top; the
// full library filterable by category below.
export default async function AcademyPage() {
  const sb = supabaseServer();
  const entity = serverEntity();
  const ec = ENTITY_CODE[entity] || "IFL";
  const today = new Date().toISOString().slice(0, 10);

  const { data: u } = await sb.auth.getUser();

  const [{ data: lessons }, { data: schedule }] = await Promise.all([
    sb.from("academy_lessons").select("*").order("delivered_at", { ascending: false }).limit(200),
    u.user?.id
      ? sb.from("pa_schedule_state").select("daily_academy_time").eq("user_id", u.user.id).maybeSingle()
      : Promise.resolve({ data: null } as any),
  ]);

  const scoped = (lessons || []).filter((l: any) => !l.entity_code || l.entity_code === ec);
  const todays = scoped.find((l: any) => l.delivered_at === today) || scoped[0] || null;
  const rest = scoped.filter((l: any) => l.id !== todays?.id);

  return (
    <main className="mx-auto max-w-3xl lg:max-w-5xl px-6 py-10">
      <Link href="/develop" className="font-mono text-[10px] uppercase tracking-wide text-clay">← develop</Link>
      <p className="mt-6 font-mono text-[10px] uppercase tracking-wide" style={{ color: "var(--accent)" }}>
        Academy · daily {schedule?.daily_academy_time ? `at ${schedule.daily_academy_time}` : ""}
      </p>
      <h1 className="mt-2 font-serif text-4xl leading-tight text-ink">One lesson a day.</h1>
      <p className="mt-2 font-serif italic text-[15px] text-ink-soft">
        The PA drops one short lesson each morning. Read it, mark it, move on.
      </p>

      <AcademyBoard todays={todays} rest={rest} me={u.user?.id || null} />
    </main>
  );
}
