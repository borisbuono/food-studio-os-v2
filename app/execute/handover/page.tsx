"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { getMyProfile, MyProfile } from "@/lib/profile";
import { ENTITY_TO_RESTAURANT, EntityKey } from "@/lib/entities";
import { noEmoji } from "@/lib/text";

type Item = {
  key: string;          // mep:<id> | task:<id>
  kind: "prep" | "cleaning" | "haccp_check";
  id: string;
  name: string;
  how: string | null;   // sub_text = embedded SOP / how-to
  zone: string;
  slot: "open" | "prep" | "service" | "close" | "weekly";
  freq: string | null;
  products: string[];
  signoff: boolean;
};

const SLOT_LABEL: Record<Item["slot"], string> = { open: "Opening", prep: "Prep for service", service: "Through service", close: "Close-down", weekly: "Weekly" };
const SLOT_ORDER: Item["slot"][] = ["open", "prep", "service", "close", "weekly"];
const dayName = (d: Date) => d.toLocaleDateString("en-GB", { weekday: "long" }).toLowerCase();

function slotOf(kind: Item["kind"], freq: string | null): Item["slot"] {
  if (kind === "prep") return "prep";
  const f = (freq || "").toLowerCase();
  if (f.includes("open")) return "open";
  if (f.includes("close")) return "close";
  if (f.startsWith("weekly")) return "weekly";
  return "service";
}

export default function ThePass() {
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [ready, setReady] = useState(false);
  const [rid, setRid] = useState<string | null>(null);
  const [venueName, setVenueName] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [doneToday, setDoneToday] = useState<Record<string, boolean>>({});
  const [plan, setPlan] = useState<Record<string, "ahead" | "todo">>({});
  const [extraShop, setExtraShop] = useState("");
  const [note, setNote] = useState("");
  const [step, setStep] = useState(0);
  const [openHow, setOpenHow] = useState<string | null>(null);
  const [passed, setPassed] = useState(false);
  const [busy, setBusy] = useState(false);

  const today = new Date();
  const tomorrow = new Date(Date.now() + 864e5);
  const todayStr = today.toISOString().slice(0, 10);
  const tmwWeekday = dayName(tomorrow);

  useEffect(() => {
    (async () => {
      const p = await getMyProfile(); setProfile(p);
      const ent = (p && !p.isAdmin ? p.entity : ((localStorage.getItem("fs_entity") as EntityKey) || "utopia")) || "utopia";
      const restaurant = p?.restaurantId || ENTITY_TO_RESTAURANT[ent] || ENTITY_TO_RESTAURANT.utopia!;
      setRid(restaurant);
      const { data: zs } = await supabaseBrowser.from("zones").select("id,name,area").eq("restaurant_id", restaurant);
      const rname = (await supabaseBrowser.from("restaurants").select("name").eq("id", restaurant).maybeSingle()).data?.name;
      setVenueName(rname || "Your venue");
      const zoneIds = (zs || []).map((z: any) => z.id);
      const zmap = new Map((zs || []).map((z: any) => [z.id, z.name]));
      if (!zoneIds.length) { setReady(true); return; }
      const [{ data: mep }, { data: tasks }, { data: tc }, { data: mc }] = await Promise.all([
        supabaseBrowser.from("mep_dishes").select("id,zone_id,name,sort_order").in("zone_id", zoneIds).eq("is_active", true),
        supabaseBrowser.from("tasks").select("id,zone_id,name,sub_text,task_type,frequency_rule,products_required,sign_off_required,sort_order").in("zone_id", zoneIds).eq("is_active", true),
        supabaseBrowser.from("task_completions").select("task_id").eq("service_date", todayStr),
        supabaseBrowser.from("mep_completions").select("component_id").eq("service_date", todayStr),
      ]);
      const it: Item[] = [];
      (mep || []).forEach((m: any) => it.push({ key: "mep:" + m.id, kind: "prep", id: m.id, name: noEmoji(m.name), how: null, zone: zmap.get(m.zone_id) || "", slot: "prep", freq: null, products: [], signoff: false }));
      (tasks || []).forEach((t: any) => it.push({ key: "task:" + t.id, kind: (t.task_type === "haccp_check" ? "haccp_check" : "cleaning"), id: t.id, name: noEmoji(t.name), how: t.sub_text || null, zone: zmap.get(t.zone_id) || "", slot: slotOf(t.task_type === "haccp_check" ? "cleaning" : "cleaning", t.frequency_rule), freq: t.frequency_rule || null, products: Array.isArray(t.products_required) ? t.products_required : [], signoff: !!t.sign_off_required }));
      const dt: Record<string, boolean> = {};
      (tc || []).forEach((r: any) => { dt["task:" + r.task_id] = true; });
      (mc || []).forEach((r: any) => { dt["mep:" + r.component_id] = true; });
      setItems(it); setDoneToday(dt); setReady(true);
    })();
  }, []);

  const dueTomorrow = (i: Item) => {
    if (i.kind === "prep") return true;
    const f = (i.freq || "").toLowerCase();
    if (f.startsWith("daily")) return true;
    if (f.startsWith("weekly")) return f === "weekly_" + tmwWeekday;
    return true;
  };

  const grouped = useMemo(() => {
    const g: Record<string, Item[]> = {};
    items.forEach((i) => { (g[i.slot] ||= []).push(i); });
    return g;
  }, [items]);

  const openCount = items.filter((i) => !doneToday[i.key]).length;
  const tomorrowItems = useMemo(() => items.filter(dueTomorrow), [items]);
  const toDo = tomorrowItems.filter((i) => (plan[i.key] || "todo") === "todo");
  const shopping = useMemo(() => {
    const s = new Set<string>();
    toDo.forEach((i) => i.products.forEach((p) => s.add(p)));
    extraShop.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean).forEach((x) => s.add(x));
    return Array.from(s);
  }, [toDo, extraShop]);

  const toggleDone = async (i: Item) => {
    if (!profile) return;
    const now = !doneToday[i.key];
    setDoneToday((d) => ({ ...d, [i.key]: now }));
    try {
      if (i.kind === "prep") {
        if (now) await supabaseBrowser.from("mep_completions").insert({ component_id: i.id, completed_by: profile.id, service_date: todayStr });
        else await supabaseBrowser.from("mep_completions").delete().eq("component_id", i.id).eq("service_date", todayStr).eq("completed_by", profile.id);
      } else {
        if (now) await supabaseBrowser.from("task_completions").insert({ task_id: i.id, completed_by: profile.id, service_date: todayStr });
        else await supabaseBrowser.from("task_completions").delete().eq("task_id", i.id).eq("service_date", todayStr).eq("completed_by", profile.id);
      }
    } catch { setDoneToday((d) => ({ ...d, [i.key]: !now })); }
  };

  const sign = async () => {
    if (!profile || !rid) return;
    setBusy(true);
    const structured = {
      service_date: tomorrow.toISOString().slice(0, 10),
      closed_by: profile.name,
      carryover: items.filter((i) => !doneToday[i.key]).map((i) => i.name),
      tomorrow_prep: toDo.map((i) => i.name),
      shopping,
      signed_at: new Date().toISOString(),
    };
    try {
      await supabaseBrowser.from("briefings").insert({
        restaurant_id: rid, created_by: profile.id, briefing_type: "handover",
        service_date: tomorrow.toISOString().slice(0, 10),
        content: note || "(no note)", structured_content: structured,
      });
      setPassed(true);
    } catch (e) { /* surfaced below */ }
    setBusy(false);
  };

  const sendShoppingToOrdering = () => {
    localStorage.setItem("fs_order_draft", JSON.stringify(shopping.map((name) => ({ name, qty: 1, unit: "" }))));
    window.location.href = "/order";
  };

  if (!ready) return <main className="mx-auto max-w-xl px-6 py-12"><p className="font-serif text-2xl text-ink">Opening the pass…</p></main>;

  if (!profile) {
    return (
      <main className="mx-auto max-w-xl px-6 py-12">
        <Link href="/execute" className="font-sans text-sm text-ink-soft">← execute</Link>
        <h1 className="mt-6 font-serif text-3xl text-ink">The Pass</h1>
        <p className="mt-3 font-serif text-[17px] leading-relaxed text-ink-soft">Sign in to run the close-down — the pass records who closed and lands on tomorrow’s open.</p>
        <Link href="/login" className="mt-6 inline-block rounded-xl px-5 py-3 font-sans text-[14px] font-medium text-[#FCEFE7]" style={{ background: "var(--accent)" }}>Sign in</Link>
      </main>
    );
  }
  if (!items.length) {
    return (
      <main className="mx-auto max-w-xl px-6 py-12">
        <Link href="/execute" className="font-sans text-sm text-ink-soft">← execute</Link>
        <h1 className="mt-6 font-serif text-3xl text-ink">The Pass</h1>
        <p className="mt-3 font-serif text-[17px] leading-relaxed text-ink-soft">No prep or cleaning is set up for {venueName} yet. Once the daily list is loaded, the close-down runs here.</p>
      </main>
    );
  }

  if (passed) {
    return (
      <main className="mx-auto max-w-xl px-6 py-12">
        <p className="font-sans text-xs font-medium" style={{ color: "var(--accent)" }}>Passed</p>
        <h1 className="mt-2 font-serif text-3xl text-ink">The pass is signed</h1>
        <p className="mt-3 font-serif text-[17px] leading-relaxed text-ink-soft">{venueName} · closed by {profile.name}. {toDo.length} prep jobs and {shopping.length} shopping lines land on tomorrow’s open, with your note.</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/execute/briefing" className="rounded-xl px-5 py-3 font-sans text-[14px] font-medium text-[#FCEFE7]" style={{ background: "var(--accent)" }}>See tomorrow’s briefing</Link>
          {shopping.length ? <button onClick={sendShoppingToOrdering} className="rounded-xl border border-black/15 px-5 py-3 font-sans text-[14px] text-ink-soft">Send shopping to Ordering</button> : null}
        </div>
      </main>
    );
  }

  const Steps = ["Tonight", "Tomorrow", "The lists", "Sign the pass"];

  return (
    <main className="mx-auto max-w-xl px-6 py-10">
      <Link href="/execute" className="font-sans text-sm text-ink-soft">← execute</Link>
      <p className="mt-5 font-sans text-xs font-medium" style={{ color: "var(--accent)" }}>The Pass · close-down · {venueName}</p>
      <div className="mt-2 flex items-baseline justify-between">
        <h1 className="font-serif text-3xl text-ink">{Steps[step]}</h1>
        <span className="font-mono text-[11px] text-clay">{step + 1} / {Steps.length}</span>
      </div>
      <div className="mt-3 flex gap-1.5">{Steps.map((_, i) => <span key={i} className="h-1 flex-1 rounded-full" style={{ background: i <= step ? "var(--accent)" : "rgba(0,0,0,0.1)" }} />)}</div>

      {/* STEP 0 — tonight's standing, the unified list (prep + cleaning), grouped by time of day */}
      {step === 0 ? (
        <div className="mt-6">
          <p className="font-sans text-[14px] text-ink-soft">{openCount ? `${openCount} still open` : "All clear"} · tap to mark done. Open jobs carry to tomorrow.</p>
          {SLOT_ORDER.filter((s) => grouped[s]?.length).map((s) => (
            <div key={s} className="mt-5">
              <p className="font-mono text-[10px] uppercase tracking-wide text-clay">{SLOT_LABEL[s]}</p>
              <ul className="mt-2 space-y-2">
                {grouped[s].map((i) => (
                  <li key={i.key} className="rounded-xl border border-black/10 bg-card p-3">
                    <div className="flex items-start gap-3">
                      <button onClick={() => toggleDone(i)} aria-label="toggle" className="mt-0.5 h-5 w-5 shrink-0 rounded-md border transition" style={doneToday[i.key] ? { background: "var(--accent)", borderColor: "var(--accent)" } : { borderColor: "rgba(0,0,0,0.25)" }}>{doneToday[i.key] ? <span className="text-[12px] text-white">✓</span> : null}</button>
                      <div className="min-w-0 flex-1">
                        <p className={"font-sans text-[15px] " + (doneToday[i.key] ? "text-clay line-through" : "text-ink")}>{i.name}</p>
                        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">{i.zone}{i.kind === "prep" ? " · prep" : i.kind === "haccp_check" ? " · HACCP" : " · clean"}{i.signoff ? " · sign-off" : ""}</p>
                        {i.how ? <button onClick={() => setOpenHow(openHow === i.key ? null : i.key)} className="mt-1 font-mono text-[10px] uppercase tracking-wide" style={{ color: "var(--accent)" }}>{openHow === i.key ? "hide how" : "how to"}</button> : null}
                        {openHow === i.key && i.how ? <p className="mt-1 whitespace-pre-line font-serif text-[14px] leading-relaxed text-ink-soft">{i.how}</p> : null}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}

      {/* STEP 1 — walk tomorrow, mark done-ahead vs to-do */}
      {step === 1 ? (
        <div className="mt-6">
          <p className="font-sans text-[14px] text-ink-soft">Go down tomorrow’s list together. Mark what’s already prepped ahead — the rest becomes tomorrow’s prep.</p>
          <ul className="mt-4 space-y-2">
            {tomorrowItems.map((i) => {
              const st = plan[i.key] || "todo";
              return (
                <li key={i.key} className="flex items-center justify-between gap-3 rounded-xl border border-black/10 bg-card p-3">
                  <div className="min-w-0">
                    <p className="truncate font-sans text-[15px] text-ink">{i.name}</p>
                    <p className="font-mono text-[10px] uppercase tracking-wide text-clay">{i.zone}{i.kind === "prep" ? " · prep" : " · clean"}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button onClick={() => setPlan((p) => ({ ...p, [i.key]: "ahead" }))} className={"rounded-full px-3 py-1 font-sans text-[12px] " + (st === "ahead" ? "text-[#FBF8F2]" : "border border-black/15 text-ink-soft")} style={st === "ahead" ? { background: "var(--accent)" } : undefined}>done ahead</button>
                    <button onClick={() => setPlan((p) => ({ ...p, [i.key]: "todo" }))} className={"rounded-full px-3 py-1 font-sans text-[12px] " + (st === "todo" ? "text-[#FBF8F2]" : "border border-black/15 text-ink-soft")} style={st === "todo" ? { background: "var(--accent)" } : undefined}>to-do</button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {/* STEP 2 — the generated lists */}
      {step === 2 ? (
        <div className="mt-6 space-y-6">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Tomorrow’s prep · {toDo.length}</p>
            <ul className="mt-2 divide-y divide-black/10 border-y border-black/10">
              {toDo.length ? toDo.map((i) => <li key={i.key} className="flex items-baseline justify-between py-2"><span className="font-sans text-[14px] text-ink">{i.name}</span><span className="font-mono text-[10px] uppercase text-clay">{i.zone}</span></li>) : <li className="py-2 font-sans text-[14px] text-clay">Nothing — all prepped ahead.</li>}
            </ul>
          </div>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Shopping / order list · {shopping.length}</p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {shopping.map((s) => <li key={s} className="rounded-full border border-black/15 px-3 py-1 font-sans text-[13px] text-ink-soft">{s}</li>)}
            </ul>
            <textarea value={extraShop} onChange={(e) => setExtraShop(e.target.value)} placeholder="Add anything else to buy — gambas, eggs, lemons… (comma or new line)" className="mt-3 h-20 w-full rounded-xl border border-black/15 bg-card p-3 font-serif text-[15px] text-ink outline-none focus:border-ember" />
            {shopping.length ? <button onClick={sendShoppingToOrdering} className="mt-2 rounded-xl border border-black/15 px-4 py-2 font-sans text-[13px] text-ink-soft">Send shopping to Ordering →</button> : null}
          </div>
        </div>
      ) : null}

      {/* STEP 3 — note + sign */}
      {step === 3 ? (
        <div className="mt-6">
          <p className="font-sans text-[14px] text-ink-soft">A word for whoever opens tomorrow — VIPs, 86s, equipment, anything to walk into knowing. It lands on their briefing.</p>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Tomorrow: 40 covers booked, table 6 is a birthday. Fryer’s due a filter. Low on gambas — on the order. Crema set overnight, ready." className="mt-3 h-40 w-full rounded-2xl border border-black/15 bg-card p-4 font-serif text-[16px] leading-relaxed text-ink outline-none focus:border-ember" />
          <div className="mt-4 rounded-xl border border-black/10 bg-card p-4">
            <p className="font-mono text-[10px] uppercase tracking-wide text-clay">The pass</p>
            <p className="mt-1 font-sans text-[14px] text-ink-soft">{items.filter((i) => !doneToday[i.key]).length} carried over · {toDo.length} prep for tomorrow · {shopping.length} to buy · closed by {profile.name}</p>
          </div>
          <button onClick={sign} disabled={busy} className="mt-4 w-full rounded-xl px-6 py-4 font-sans text-[15px] font-medium text-[#FCEFE7] disabled:opacity-60" style={{ background: "var(--accent)" }}>{busy ? "Signing…" : "Sign & pass to tomorrow"}</button>
        </div>
      ) : null}

      {/* nav */}
      <div className="mt-8 flex items-center justify-between">
        <button onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0} className="font-sans text-[14px] text-ink-soft disabled:opacity-30">← back</button>
        {step < 3 ? <button onClick={() => setStep((s) => s + 1)} className="rounded-xl px-5 py-2.5 font-sans text-[14px] font-medium text-[#FCEFE7]" style={{ background: "var(--accent)" }}>Next →</button> : <span />}
      </div>
    </main>
  );
}
