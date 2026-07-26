import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";
import { serverEntity } from "@/lib/serverVenue";
import { EntityKey } from "@/lib/entities";
import AcademyBoard from "@/components/AcademyBoard";

export const dynamic = "force-dynamic";

const ENTITY_CODE: Record<EntityKey, string> = { holdings: "BBH", bistro_mondo: "BM", taller: "IFL", utopia: "IFL" };

// Pillars #3 — the foh-scoped Academy surface. Same shared table
// (academy_lessons), filtered by module_scope containing 'foh'.
// Existing /develop/academy remains the parent list (all lessons).
export default async function FohAcademyPage() {
  const sb = supabaseServer();
  const entity = serverEntity();
  const ec = ENTITY_CODE[entity] || "IFL";
  const today = new Date().toISOString().slice(0, 10);

  const { data: u } = await sb.auth.getUser();

  // module_scope is a text[]; @> gives us "contains foh".
  const [{ data: lessons }, { data: schedule }] = await Promise.all([
    sb.from("academy_lessons").select("*").contains("module_scope", ["foh"]).order("delivered_at", { ascending: false }).limit(200),
    u.user?.id
      ? sb.from("pa_schedule_state").select("daily_academy_time").eq("user_id", u.user.id).maybeSingle()
      : Promise.resolve({ data: null } as any),
  ]);

  const scoped = (lessons || []).filter((l: any) => !l.entity_code || l.entity_code === ec);
  const todays = scoped.find((l: any) => l.delivered_at === today) || scoped[0] || null;
  const rest = scoped.filter((l: any) => l.id !== todays?.id);

  return (
    <main className="mx-auto max-w-3xl lg:max-w-5xl px-6 py-10">
      <Link href="/foh" className="font-mono text-[10px] uppercase tracking-wide text-clay">← foh</Link>
      <p className="mt-6 font-mono text-[10px] uppercase tracking-wide" style={{ color: "var(--accent)" }}>
        Academy · service craft {schedule?.daily_academy_time ? `· daily at ${schedule.daily_academy_time}` : ""}
      </p>
      <h1 className="mt-2 font-serif text-4xl leading-tight text-ink">Serving the room, well.</h1>
      <p className="mt-2 font-serif italic text-[15px] text-ink-soft">
        Greeting, seating, pairings, guest recognition — one lesson a day.
      </p>

      {scoped.length === 0 ? (
        <section className="mt-8 border-t border-line py-8 text-center">
          <p className="font-serif italic text-[15px] text-ink-soft">
            No foh lessons in the library yet. Ask the manager to tag a lesson for foh.
          </p>
          <p className="mt-3">
            <Link href="/develop/academy" className="font-mono text-[10px] uppercase tracking-wide text-clay hover:text-ink underline decoration-black/20 underline-offset-2">
              Browse the full library →
            </Link>
          </p>
        </section>
      ) : (
        <AcademyBoard todays={todays} rest={rest} me={u.user?.id || null} />
      )}
    </main>
  );
}
