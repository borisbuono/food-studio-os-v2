"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { getMyProfile, MyProfile } from "@/lib/profile";
import { ENTITY_TO_RESTAURANT, EntityKey } from "@/lib/entities";
import { noEmoji } from "@/lib/text";

type Stage = "manage" | "maintain" | "learn";
type Skill = { key: string; name: string; how: string | null; area: string; count: number; days: number; spanDays: number; signed: boolean; stage: Stage };

const STAGE_TITLE: Record<Stage, string> = { manage: "Can manage", maintain: "Can do", learn: "Learning" };
const STAGE_BLURB: Record<Stage, string> = {
  manage: "Done it enough, over enough time, to run it and teach it.",
  maintain: "Can do it solo — keep going to earn managing it.",
  learn: "Knows the method — needs reps to own it.",
};

function stageOf(count: number, days: number, spanDays: number, signed: boolean): Stage {
  if (days >= 8 && spanDays >= 21) return "manage";
  if (count >= 3 || signed) return "maintain";
  return "learn";
}
function nextHint(s: Skill): string {
  if (s.stage === "learn") return `${s.count}/3 done · 3 to reach “can do”`;
  if (s.stage === "maintain") return `${s.days}/8 days over 3 weeks to manage${s.signed ? " · signed off" : ""}`;
  return "Mastered · ready to teach";
}

export default function Academy() {
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [ready, setReady] = useState(false);
  const [venueName, setVenueName] = useState("");
  const [skills, setSkills] = useState<Skill[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const p = await getMyProfile(); setProfile(p);
      if (!p) { setReady(true); return; }
      const ent = (!p.isAdmin ? p.entity : ((localStorage.getItem("fs_entity") as EntityKey) || "utopia")) || "utopia";
      const rid = p.restaurantId || ENTITY_TO_RESTAURANT[ent] || ENTITY_TO_RESTAURANT.utopia!;
      setVenueName((await supabaseBrowser.from("restaurants").select("name").eq("id", rid).maybeSingle()).data?.name || "Your venue");
      const { data: zs } = await supabaseBrowser.from("zones").select("id,name,area").eq("restaurant_id", rid);
      const zoneIds = (zs || []).map((z: any) => z.id);
      const zmap = new Map((zs || []).map((z: any) => [z.id, z.name]));
      if (!zoneIds.length) { setReady(true); return; }
      const { data: dishes } = await supabaseBrowser.from("mep_dishes").select("id,zone_id,name").in("zone_id", zoneIds);
      const dishIds = (dishes || []).map((d: any) => d.id);
      const dmap = new Map((dishes || []).map((d: any) => [d.id, { zone: zmap.get(d.zone_id) || "", name: d.name }]));
      const [{ data: tasks }, { data: comps }, { data: tc }, { data: mc }] = await Promise.all([
        supabaseBrowser.from("tasks").select("id,zone_id,name,sub_text,task_type").in("zone_id", zoneIds).eq("is_active", true),
        dishIds.length ? supabaseBrowser.from("mep_components").select("id,mep_dish_id,name,method").in("mep_dish_id", dishIds) : Promise.resolve({ data: [] as any[] }),
        supabaseBrowser.from("task_completions").select("task_id,service_date,manager_approved").eq("completed_by", p.id),
        supabaseBrowser.from("mep_completions").select("component_id,service_date").eq("completed_by", p.id),
      ]);
      const tcByTask = new Map<string, { dates: Set<string>; signed: boolean }>();
      (tc || []).forEach((r: any) => { const e = tcByTask.get(r.task_id) || { dates: new Set(), signed: false }; e.dates.add(r.service_date); if (r.manager_approved) e.signed = true; tcByTask.set(r.task_id, e); });
      const mcByComp = new Map<string, Set<string>>();
      (mc || []).forEach((r: any) => { const e = mcByComp.get(r.component_id) || new Set(); e.add(r.service_date); mcByComp.set(r.component_id, e); });
      const span = (dates: Set<string>) => { if (dates.size < 2) return 0; const ds = Array.from(dates).map((d) => new Date(d + "T00:00").getTime()); return Math.round((Math.max(...ds) - Math.min(...ds)) / 864e5); };
      const out: Skill[] = [];
      (tasks || []).forEach((t: any) => { const e = tcByTask.get(t.id) || { dates: new Set<string>(), signed: false }; const days = e.dates.size; const sp = span(e.dates); const stage = stageOf(days, days, sp, e.signed); out.push({ key: "task:" + t.id, name: noEmoji(t.name), how: t.sub_text || null, area: zmap.get(t.zone_id) || (t.task_type === "haccp_check" ? "HACCP" : ""), count: days, days, spanDays: sp, signed: e.signed, stage }); });
      (comps || []).forEach((c: any) => { const dates = mcByComp.get(c.id) || new Set<string>(); const days = dates.size; const sp = span(dates); const d = dmap.get(c.mep_dish_id); const stage = stageOf(days, days, sp, false); out.push({ key: "mep:" + c.id, name: noEmoji(c.name) + (d ? ` · ${d.name.split(" — ")[0]}` : ""), how: c.method || null, area: d?.zone || "Prep", count: days, days, spanDays: sp, signed: false, stage }); });
      setSkills(out); setReady(true);
    })();
  }, []);

  if (!ready) return <main className="mx-auto max-w-xl px-6 py-12"><p className="font-serif text-2xl text-ink">Opening your academy…</p></main>;
  if (!profile) return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/" className="font-sans text-sm text-ink-soft">← home</Link>
      <h1 className="mt-6 font-serif text-3xl text-ink">Academy</h1>
      <p className="mt-3 font-serif text-[17px] leading-relaxed text-ink-soft">Sign in to see your skills grow — every job you do is logged against its SOP and builds your ladder.</p>
      <Link href="/login" className="mt-6 inline-block rounded-xl px-5 py-3 font-sans text-[14px] font-medium text-[#F7F7F4]" style={{ background: "var(--accent)" }}>Sign in</Link>
    </main>
  );

  const counts = { manage: skills.filter((s) => s.stage === "manage").length, maintain: skills.filter((s) => s.stage === "maintain").length, learn: skills.filter((s) => s.stage === "learn").length };
  const order: Stage[] = ["manage", "maintain", "learn"];

  return (
    <main className="mx-auto max-w-xl px-6 py-10">
      <Link href="/" className="font-sans text-sm text-ink-soft">← home</Link>
      <p className="mt-5 font-sans text-xs font-medium" style={{ color: "var(--accent)" }}>Academy · {profile.name} · {venueName}</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">Your skills</h1>
      <p className="mt-2 font-sans text-[14px] leading-relaxed text-ink-soft">Every job has an SOP behind it. Learn it, do it, then — after a real run of doing it — manage it. {counts.manage} managing · {counts.maintain} you can do · {counts.learn} learning.</p>

      {order.map((st) => {
        const list = skills.filter((s) => s.stage === st).sort((a, b) => b.days - a.days);
        if (!list.length) return null;
        return (
          <div key={st} className="mt-8">
            <p className="font-mono text-[10px] uppercase tracking-wide text-clay">{STAGE_TITLE[st]} · {list.length}</p>
            <p className="font-sans text-[12px] text-clay">{STAGE_BLURB[st]}</p>
            <ul className="mt-3 space-y-2">
              {list.map((s) => (
                <li key={s.key} className="rounded-xl border border-black/10 bg-card p-4">
                  <button onClick={() => setOpen(open === s.key ? null : s.key)} className="flex w-full items-baseline justify-between gap-3 text-left">
                    <span className="font-sans text-[15px] text-ink">{s.name}</span>
                    <span className="shrink-0 font-mono text-[10px] uppercase tracking-wide" style={{ color: st === "learn" ? undefined : "var(--accent)" }}>{nextHint(s)}</span>
                  </button>
                  <p className="font-mono text-[10px] uppercase tracking-wide text-clay">{s.area}{s.signed ? " · signed off" : ""}</p>
                  {open === s.key && s.how ? <p className="mt-2 whitespace-pre-line font-serif text-[14px] leading-relaxed text-ink-soft">{s.how}</p> : null}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {profile.isAdmin ? <p className="mt-8 font-mono text-[10px] uppercase tracking-wide text-clay">Manager team view (everyone’s ladder + sign-off) comes next.</p> : null}
    </main>
  );
}
