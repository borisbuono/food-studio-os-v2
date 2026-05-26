"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { getMyProfile } from "@/lib/profile";
import { ENTITY_TO_RESTAURANT, EntityKey } from "@/lib/entities";
import { noEmoji } from "@/lib/text";

type Plan = { id: string; plan_code: string; plan_name: string; status: string | null; responsible_role: string | null; description: string | null; review_frequency: string | null };
type Task = { id: string; name: string; sub_text: string | null; task_type: string; haccp_plan_id: string | null; zone: string; freq: string | null };

function clip(s: string, n = 220) { s = (s || "").trim(); return s.length > n ? s.slice(0, n).trim() + "…" : s; }

export default function Sops() {
  const [ready, setReady] = useState(false);
  const [venueName, setVenueName] = useState("");
  const [plans, setPlans] = useState<Plan[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const p = await getMyProfile();
      const ent = (p && !p.isAdmin ? p.entity : ((localStorage.getItem("fs_entity") as EntityKey) || "utopia")) || "utopia";
      const rid = p?.restaurantId || ENTITY_TO_RESTAURANT[ent] || ENTITY_TO_RESTAURANT.utopia!;
      const rname = (await supabaseBrowser.from("restaurants").select("name").eq("id", rid).maybeSingle()).data?.name;
      setVenueName(rname || "Your venue");
      const { data: pl } = await supabaseBrowser.from("haccp_plans").select("id,plan_code,plan_name,status,responsible_role,description,review_frequency").eq("restaurant_id", rid).order("plan_code");
      const { data: zs } = await supabaseBrowser.from("zones").select("id,name").eq("restaurant_id", rid);
      const zmap = new Map((zs || []).map((z: any) => [z.id, z.name]));
      const zoneIds = (zs || []).map((z: any) => z.id);
      let tk: Task[] = [];
      if (zoneIds.length) {
        const { data: ts } = await supabaseBrowser.from("tasks").select("id,zone_id,name,sub_text,task_type,haccp_plan_id,frequency_rule").in("zone_id", zoneIds).eq("is_active", true);
        tk = (ts || []).map((t: any) => ({ id: t.id, name: noEmoji(t.name), sub_text: t.sub_text, task_type: t.task_type, haccp_plan_id: t.haccp_plan_id, zone: zmap.get(t.zone_id) || "", freq: t.frequency_rule }));
      }
      setPlans(pl || []); setTasks(tk); setReady(true);
    })();
  }, []);

  if (!ready) return <main className="mx-auto max-w-xl px-6 py-12"><p className="font-serif text-2xl text-ink">Opening the Libro Azul…</p></main>;

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/execute" className="font-sans text-sm text-ink-soft">← execute</Link>
      <p className="mt-6 font-sans text-xs font-medium text-basil">Libro Azul · SOPs &amp; HACCP · {venueName}</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">How we do it, correctly</h1>
      <p className="mt-2 font-sans text-[14px] leading-relaxed text-ink-soft">{plans.length} plans. Each one drives the real jobs on the daily list — tap a plan to see the tasks that carry it out.</p>

      <div className="mt-8 space-y-3">
        {plans.map((p) => {
          const linked = tasks.filter((t) => t.haccp_plan_id === p.id);
          const isOpen = open === p.id;
          return (
            <div key={p.id} className="rounded-2xl border border-black/10 bg-card p-5">
              <button onClick={() => setOpen(isOpen ? null : p.id)} className="flex w-full items-baseline justify-between gap-4 text-left">
                <h2 className="font-serif text-xl text-ink">{noEmoji(p.plan_name || "Untitled plan")}</h2>
                <span className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-clay">{linked.length} task{linked.length === 1 ? "" : "s"}{isOpen ? " ▾" : " ▸"}</span>
              </button>
              <p className="mt-1 font-mono text-[11px] text-clay">{[p.plan_code, p.responsible_role, p.review_frequency].filter(Boolean).join(" · ")}</p>
              {isOpen ? (
                <>
                  {p.description ? <p className="mt-3 font-sans text-[14px] leading-relaxed text-ink-soft">{clip(p.description)}</p> : null}
                  {linked.length ? (
                    <ul className="mt-4 space-y-2 border-t border-black/10 pt-4">
                      {linked.map((t) => (
                        <li key={t.id}>
                          <p className="font-sans text-[14px] text-ink">{t.name} <span className="font-mono text-[10px] uppercase text-clay">· {t.zone}</span></p>
                          {t.sub_text ? <p className="mt-0.5 whitespace-pre-line font-serif text-[13px] leading-relaxed text-ink-soft">{t.sub_text}</p> : null}
                        </li>
                      ))}
                    </ul>
                  ) : <p className="mt-3 font-sans text-[13px] text-clay">No daily tasks linked yet — this plan is on record but not yet on anyone’s list.</p>}
                </>
              ) : null}
            </div>
          );
        })}
        {!plans.length ? <p className="font-sans text-[14px] text-clay">No plans for {venueName} yet — the standard Libro Azul set loads at onboarding.</p> : null}
      </div>

      <p className="mt-8 font-mono text-[10px] uppercase tracking-wide text-clay">The how-to lives on each task in Today and The Pass — this is the same library, seen from the plan side.</p>
    </main>
  );
}
