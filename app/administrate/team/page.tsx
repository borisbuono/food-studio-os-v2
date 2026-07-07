import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";
import { noEmoji } from "@/lib/text";
import InviteTeammate from "@/components/InviteTeammate";

export const dynamic = "force-dynamic";

export default async function Team() {
  
  const supabase = supabaseServer();const venues = (await supabase.from("restaurants").select("id,name")).data || [];
  const vname = new Map(venues.map((v: any) => [v.id, v.name]));
  const members = (await supabase.from("team_members").select("name,email,default_role,default_restaurant_id,status,first_login_at,invited_at").order("name")).data || [];
  const profiles = (await supabase.from("profiles").select("id,name,role,restaurant_id,color").order("name")).data || [];
  const shifts = await supabase.from("shifts").select("*", { count: "exact", head: true });

  // Onboarding circle (RELEASE_PLAN): keep the funnel visible.
  const now = new Date();
  const day = (now.getDay() + 6) % 7; // 0 = Monday
  const weekStart = new Date(now); weekStart.setDate(now.getDate() - day); weekStart.setHours(0, 0, 0, 0);
  const pending = members.filter((m: any) => (m.status || "invited") === "invited").length;
  const joinedThisWeek = members.filter((m: any) => m.first_login_at && new Date(m.first_login_at) >= weekStart).length;

  const people = [
    ...members.map((m: any) => ({ name: m.name, role: m.default_role, venue: vname.get(m.default_restaurant_id), status: m.status })),
    ...profiles.map((p: any) => ({ id: p.id, name: p.name, role: p.role, venue: vname.get(p.restaurant_id), status: "profile" })),
  ].filter((p) => p.name);

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/" className="font-sans text-sm text-ink-soft">← home</Link>
      <p className="mt-6 font-sans text-xs font-medium text-ink-soft">Team · HR & schedule</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">Who’s on the team</h1>
      {(pending || joinedThisWeek) ? (
        <p className="mt-3 font-sans text-[13px] text-ink-soft">
          {joinedThisWeek ? <span>{joinedThisWeek} {joinedThisWeek === 1 ? "person" : "people"} joined this week</span> : null}
          {joinedThisWeek && pending ? <span className="text-clay"> · </span> : null}
          {pending ? <span>{pending} {pending === 1 ? "invite" : "invites"} still pending</span> : null}
        </p>
      ) : null}

      <InviteTeammate venues={venues} />

      <Link href="/administrate/team/invite" className="mt-4 inline-block rounded-xl border border-black/15 px-4 py-2 font-sans text-[14px] text-ink transition hover:border-black/30">+ Add to team</Link>

      <Link href="/administrate/team/schedule" className="mt-6 block rounded-2xl border border-line bg-card p-5 transition hover:border-line">
        <p className="font-sans text-xs font-medium text-ink-soft">Schedule</p>
        <h2 className="mt-1 font-serif text-xl text-ink">Weekly rota</h2>
        <p className="mt-1 font-sans text-[13px] text-ink-soft">{(shifts.count ?? 0) === 0 ? "Browse by week — FOH / BOH, by zone." : (shifts.count + " shifts scheduled.")}</p>
      </Link>

      <div className="mt-6 divide-y divide-black/10">
        {people.map((p: any, i: number) => {
          const inner = (
            <>
              <div>
                <p className="font-serif text-[19px] text-ink">{noEmoji(p.name)}</p>
                <p className="font-mono text-[11px] uppercase tracking-wide text-clay">{[p.role, p.venue].filter(Boolean).join(" · ")}</p>
              </div>
              <span className="font-mono text-[11px] text-clay">{p.status || ""}</span>
            </>
          );
          return p.id ? (
            <Link key={i} href={"/administrate/team/" + p.id} className="flex items-baseline justify-between gap-4 py-3 transition hover:text-ink-soft">{inner}</Link>
          ) : (
            <div key={i} className="flex items-baseline justify-between gap-4 py-3">{inner}</div>
          );
        })}
        {!people.length ? <p className="py-3 font-sans text-[14px] text-clay">No team members yet — invite the team to populate this.</p> : null}
      </div>
    </main>
  );
}
