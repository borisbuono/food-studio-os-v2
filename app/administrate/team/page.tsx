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

      <div className="mt-6 rounded-2xl border border-dashed border-black/20 p-5">
        <p className="font-sans text-[14px] text-ink-soft">{(shifts.count ?? 0) === 0 ? "No shifts scheduled yet — the weekly rota (FOH / BOH, by zone) appears here." : (shifts.count + " shifts scheduled.")}</p>
      </div>

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
