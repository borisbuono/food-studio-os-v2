import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { noEmoji } from "@/lib/text";

export const dynamic = "force-dynamic";

export default async function Team() {
  const venues = (await supabase.from("restaurants").select("id,name")).data || [];
  const vname = new Map(venues.map((v: any) => [v.id, v.name]));
  const members = (await supabase.from("team_members").select("name,email,default_role,default_restaurant_id,status").order("name")).data || [];
  const profiles = (await supabase.from("profiles").select("name,role,restaurant_id").order("name")).data || [];
  const shifts = await supabase.from("shifts").select("*", { count: "exact", head: true });

  const people = [
    ...members.map((m: any) => ({ name: m.name, role: m.default_role, venue: vname.get(m.default_restaurant_id), status: m.status })),
    ...profiles.map((p: any) => ({ name: p.name, role: p.role, venue: vname.get(p.restaurant_id), status: "profile" })),
  ].filter((p) => p.name);

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/administrate" className="font-sans text-sm text-ink-soft">← administrate</Link>
      <p className="mt-6 font-sans text-xs font-medium text-ember">Team · HR & schedule</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">Who’s on the team</h1>

      <Link href="/schedule" className="mt-6 block rounded-2xl border border-black/10 bg-card p-5 transition hover:border-ember/40">
        <p className="font-sans text-xs font-medium text-ember">Schedule</p>
        <h2 className="mt-1 font-serif text-xl text-ink">Weekly rota</h2>
        <p className="mt-1 font-sans text-[13px] text-ink-soft">{(shifts.count ?? 0) === 0 ? "Browse by week — FOH / BOH, by zone." : (shifts.count + " shifts scheduled.")}</p>
      </Link>

      <div className="mt-6 divide-y divide-black/10">
        {people.map((p: any, i: number) => (
          <div key={i} className="flex items-baseline justify-between gap-4 py-3">
            <div>
              <p className="font-serif text-[19px] text-ink">{noEmoji(p.name)}</p>
              <p className="font-mono text-[11px] uppercase tracking-wide text-clay">{[p.role, p.venue].filter(Boolean).join(" · ")}</p>
            </div>
            <span className="font-mono text-[11px] text-clay">{p.status || ""}</span>
          </div>
        ))}
        {!people.length ? <p className="py-3 font-sans text-[14px] text-clay">No team members yet — invite the team to populate this.</p> : null}
      </div>
    </main>
  );
}
