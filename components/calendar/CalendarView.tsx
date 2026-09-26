"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  EVENT_SOURCES, SOURCE_LABEL, addDaysYmd, canReschedule, eventColour, mondayOf, zonedParts, zonedToUtc,
  type CalEvent, type EventSource,
} from "@/lib/calendar";

// Unified OS calendar — Notion-Calendar model: merged sources, colour per
// source, keyboard-first, drag to reschedule (writes back to the source row).
//
// Keys: t today · d day · w week · a agenda · j/→ next · k/← prev · Esc close.

type View = "day" | "week" | "agenda";

export type CalendarViewProps = {
  title: string;
  kicker: string;
  tz: string;
  todayYmd: string;
  initialEvents: CalEvent[];
  initialPeople: Record<string, string>;
  initialView?: View;
  scope: { entityId?: string | null; mine?: boolean; external?: boolean };
  entitySlugs?: Record<string, string>;   // entity_id → house slug, for source links
  entityNames?: Record<string, string>;   // entity_id → name, shown on personal view
  canRebuild?: boolean;
  extraActions?: React.ReactNode;
};

const HOUR_PX = 44;
const SNAP_MIN = 15;
const DAY_MIN = 24 * 60;

function rangeFor(view: View, anchor: string): [string, number] {
  if (view === "week") return [mondayOf(anchor), 7];
  if (view === "day") return [anchor, 1];
  return [anchor, 14];
}

function fmtTime(iso: string, tz: string) {
  const p = zonedParts(iso, tz);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

function dayLabel(ymd: string, tz: string) {
  const d = zonedToUtc(ymd, 12, 0, tz);
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short" }).format(d);
}

function sourceHref(e: CalEvent, slugs: Record<string, string>): string | null {
  const slug = e.entity_id ? slugs[e.entity_id] : null;
  switch (e.source_type) {
    case "interview": return slug ? `/h/${slug}/office/hiring` : null;
    case "shift": return slug ? `/h/${slug}/team?tab=labour` : null;
    case "social": return "/grow/reach/calendar";
    default: return null;
  }
}

type Placed = { e: CalEvent; ymd: string; top: number; height: number; col: number; cols: number };

function placeDay(events: CalEvent[], ymd: string, tz: string): Placed[] {
  const dayStart = zonedToUtc(ymd, 0, 0, tz).getTime();
  const dayEnd = zonedToUtc(addDaysYmd(ymd, 1), 0, 0, tz).getTime();
  const items: { e: CalEvent; s: number; en: number }[] = [];
  for (const e of events) {
    if (e.all_day) continue;
    const s = new Date(e.start_ts).getTime();
    const en = e.end_ts ? new Date(e.end_ts).getTime() : s + 30 * 60_000;
    if (en <= dayStart || s >= dayEnd) continue;
    items.push({ e, s: Math.max(s, dayStart), en: Math.min(Math.max(en, s + 20 * 60_000), dayEnd) });
  }
  items.sort((a, b) => a.s - b.s || b.en - a.en);
  const out: Placed[] = [];
  let group: { item: (typeof items)[number]; col: number }[] = [];
  let groupEnd = -1;
  const flush = () => {
    const cols = Math.max(1, ...group.map((g) => g.col + 1));
    for (const g of group) {
      const top = ((g.item.s - dayStart) / 60_000) * (HOUR_PX / 60);
      const height = Math.max(20, ((g.item.en - g.item.s) / 60_000) * (HOUR_PX / 60));
      out.push({ e: g.item.e, ymd, top, height, col: g.col, cols });
    }
    group = [];
  };
  for (const it of items) {
    if (group.length && it.s >= groupEnd) { flush(); groupEnd = -1; }
    const used = new Set(group.filter((g) => g.item.en > it.s).map((g) => g.col));
    let col = 0;
    while (used.has(col)) col++;
    group.push({ item: it, col });
    groupEnd = Math.max(groupEnd, it.en);
  }
  if (group.length) flush();
  return out;
}

function eventDays(e: CalEvent, tz: string): string[] {
  const s = zonedParts(e.start_ts, tz).ymd;
  if (!e.end_ts) return [s];
  const endIso = new Date(new Date(e.end_ts).getTime() - 1).toISOString();
  const en = zonedParts(endIso, tz).ymd;
  const out = [s];
  let cur = s;
  for (let i = 0; i < 40 && cur < en; i++) { cur = addDaysYmd(cur, 1); out.push(cur); }
  return out;
}

export default function CalendarView(p: CalendarViewProps) {
  const [view, setView] = useState<View>(p.initialView || "week");
  const [anchor, setAnchor] = useState(p.todayYmd);
  const [events, setEvents] = useState<CalEvent[]>(p.initialEvents);
  const [people, setPeople] = useState<Record<string, string>>(p.initialPeople);
  const [hidden, setHidden] = useState<Set<EventSource>>(new Set());
  const [person, setPerson] = useState<string>("");
  const [selected, setSelected] = useState<CalEvent | null>(null);
  const [creating, setCreating] = useState<{ start: Date; end: Date } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const firstLoad = useRef(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const [startYmd, nDays] = rangeFor(view, anchor);
  const days = useMemo(() => Array.from({ length: nDays }, (_, i) => addDaysYmd(startYmd, i)), [startYmd, nDays]);

  const load = useCallback(async () => {
    const from = zonedToUtc(startYmd, 0, 0, p.tz).toISOString();
    const to = zonedToUtc(addDaysYmd(startYmd, nDays), 0, 0, p.tz).toISOString();
    const qs = new URLSearchParams({ from, to });
    if (p.scope.entityId) qs.set("entity", p.scope.entityId);
    if (p.scope.mine) qs.set("mine", "1");
    if (p.scope.external) qs.set("external", "1");
    setLoading(true);
    try {
      const r = await fetch(`/api/events?${qs}`, { cache: "no-store" });
      const j = await r.json();
      if (j.ok) { setEvents(j.events); setPeople((prev) => ({ ...prev, ...j.people })); }
      else setToast(j.error || "Could not load");
    } catch { setToast("Offline — showing last loaded"); }
    setLoading(false);
  }, [startYmd, nDays, p.tz, p.scope.entityId, p.scope.mine, p.scope.external]);

  useEffect(() => {
    if (firstLoad.current) { firstLoad.current = false; if (view === (p.initialView || "week")) return; }
    load();
  }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 7 * HOUR_PX;
  }, [view]);

  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(null), 3500); return () => clearTimeout(t); } }, [toast]);

  const step = useCallback((dir: 1 | -1) => {
    setAnchor((a) => addDaysYmd(a, dir * (view === "week" ? 7 : view === "day" ? 1 : 14)));
  }, [view]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      const k = ev.key;
      if (k === "t") setAnchor(p.todayYmd);
      else if (k === "d") setView("day");
      else if (k === "w") setView("week");
      else if (k === "a") setView("agenda");
      else if (k === "j" || k === "ArrowRight") step(1);
      else if (k === "k" || k === "ArrowLeft") step(-1);
      else if (k === "Escape") { setSelected(null); setCreating(null); }
      else return;
      ev.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, p.todayYmd]);

  const present = useMemo(() => {
    const s = new Set<EventSource>();
    events.forEach((e) => s.add(e.source_type));
    return EVENT_SOURCES.filter((x) => s.has(x));
  }, [events]);

  const visible = useMemo(
    () => events.filter((e) => !hidden.has(e.source_type) && (!person || (e.person_ids || []).includes(person))),
    [events, hidden, person],
  );

  const peopleInView = useMemo(() => {
    const ids = new Set<string>();
    events.forEach((e) => (e.person_ids || []).forEach((i) => ids.add(i)));
    return Array.from(ids).filter((i) => people[i]).sort((a, b) => people[a].localeCompare(people[b]));
  }, [events, people]);

  // ------------------------------------------------------------- drag
  const [drag, setDrag] = useState<{ id: string; dMin: number; dDay: number } | null>(null);
  const dragRef = useRef<{ e: CalEvent; x: number; y: number; moved: boolean; colW: number } | null>(null);

  const onPointerDown = (ev: React.PointerEvent, e: CalEvent) => {
    if (ev.button !== 0) return;
    const colW = gridRef.current ? gridRef.current.getBoundingClientRect().width / days.length : 100;
    dragRef.current = { e, x: ev.clientX, y: ev.clientY, moved: false, colW };
    (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
  };
  const onPointerMove = (ev: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || !canReschedule(d.e)) return;
    const dy = ev.clientY - d.y, dx = ev.clientX - d.x;
    if (!d.moved && Math.abs(dy) < 5 && Math.abs(dx) < 5) return;
    d.moved = true;
    const dMin = Math.round(((dy / HOUR_PX) * 60) / SNAP_MIN) * SNAP_MIN;
    const dDay = view === "week" ? Math.round(dx / d.colW) : 0;
    setDrag({ id: d.e.id, dMin, dDay });
  };
  const onPointerUp = async () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    if (!d.moved) { setSelected(d.e); return; }
    const cur = drag;
    setDrag(null);
    if (!cur || (cur.dMin === 0 && cur.dDay === 0)) return;
    const shift = (cur.dDay * DAY_MIN + cur.dMin) * 60_000;
    const oldS = new Date(d.e.start_ts).getTime();
    const newStart = new Date(oldS + shift).toISOString();
    const newEnd = d.e.end_ts ? new Date(new Date(d.e.end_ts).getTime() + shift).toISOString() : null;
    const before = events;
    setEvents((xs) => xs.map((x) => (x.id === d.e.id ? { ...x, start_ts: newStart, end_ts: newEnd } : x)));
    try {
      const r = await fetch(`/api/events/${d.e.id}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ start_ts: newStart, end_ts: newEnd }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "Not saved");
      if (j.event) setEvents((xs) => xs.map((x) => (x.id === d.e.id ? j.event : x)));
      setToast(`Moved to ${dayLabel(zonedParts(newStart, p.tz).ymd, p.tz)} ${fmtTime(newStart, p.tz)}`);
    } catch (err: any) {
      setEvents(before);
      setToast(String(err?.message || err));
    }
  };

  const onGridDoubleClick = (ev: React.MouseEvent, ymd: string) => {
    const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    const min = Math.floor((((ev.clientY - rect.top) / HOUR_PX) * 60) / 30) * 30;
    const start = zonedToUtc(ymd, Math.floor(min / 60), min % 60, p.tz);
    setCreating({ start, end: new Date(start.getTime() + 60 * 60_000) });
  };

  const rebuild = async () => {
    if (!p.scope.entityId) return;
    setLoading(true);
    const r = await fetch(`/api/events/rebuild?source=all&entity=${p.scope.entityId}`, { method: "POST" });
    const j = await r.json().catch(() => ({}));
    setToast(j.ok ? "Re-synced from source tables" : j.error || "Re-sync failed");
    await load();
  };

  const nowIso = new Date().toISOString();
  const nowParts = zonedParts(nowIso, p.tz);

  // ------------------------------------------------------------- render
  const header = (
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-black/10 pb-3">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">{p.kicker}</p>
        <h1 className="font-serif text-2xl">{p.title}</h1>
        <p className="mt-0.5 text-xs text-clay">
          {view === "day" ? dayLabel(anchor, p.tz) : `${dayLabel(days[0], p.tz)} – ${dayLabel(days[days.length - 1], p.tz)}`}
          {" · "}<span className="font-mono">{p.tz}</span>{loading ? " · loading…" : ""}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <button onClick={() => step(-1)} className="rounded border border-black/15 px-2 py-1" title="Previous (k)">‹</button>
        <button onClick={() => setAnchor(p.todayYmd)} className="rounded border border-black/15 px-2 py-1" title="Today (t)">Today</button>
        <button onClick={() => step(1)} className="rounded border border-black/15 px-2 py-1" title="Next (j)">›</button>
        <span className="mx-1 h-4 w-px bg-black/10" />
        {(["day", "week", "agenda"] as View[]).map((v) => (
          <button key={v} onClick={() => setView(v)} title={`${v} (${v[0]})`}
            className={`rounded px-2 py-1 ${view === v ? "bg-ink text-white" : "border border-black/15"}`}>
            {v[0].toUpperCase() + v.slice(1)}
          </button>
        ))}
        {p.canRebuild && p.scope.entityId ? (
          <button onClick={rebuild} className="rounded border border-black/15 px-2 py-1" title="Re-sync this venue from source tables">Re-sync</button>
        ) : null}
        {p.extraActions}
      </div>
    </div>
  );

  const chips = (
    <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px]">
      {present.map((s) => {
        const off = hidden.has(s);
        const sample = events.find((e) => e.source_type === s);
        return (
          <button key={s} onClick={() => setHidden((h) => { const n = new Set(h); off ? n.delete(s) : n.add(s); return n; })}
            className={`flex items-center gap-1 rounded-full border px-2 py-0.5 ${off ? "border-black/10 text-clay line-through" : "border-black/20"}`}>
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: sample ? eventColour(sample) : "#999" }} />
            {SOURCE_LABEL[s]} <span className="tabular-nums text-clay">{events.filter((e) => e.source_type === s).length}</span>
          </button>
        );
      })}
      {peopleInView.length ? (
        <select value={person} onChange={(e) => setPerson(e.target.value)} className="ml-1 rounded border border-black/15 bg-white px-1.5 py-0.5">
          <option value="">Everyone</option>
          {peopleInView.map((id) => <option key={id} value={id}>{people[id]}</option>)}
        </select>
      ) : null}
      {!present.length && !loading ? <span className="text-clay">Nothing in this range.</span> : null}
    </div>
  );

  const block = (pl: Placed, dayIdx: number) => {
    const e = pl.e;
    const isDrag = drag?.id === e.id;
    const dTop = isDrag ? (drag!.dMin / 60) * HOUR_PX : 0;
    const dLeft = isDrag ? drag!.dDay * 100 : 0;
    const colour = eventColour(e);
    const ext = e.source_type === "external";
    const movable = canReschedule(e);
    return (
      <div key={`${e.id}-${pl.ymd}`}
        onPointerDown={(ev) => onPointerDown(ev, e)} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        className={`absolute overflow-hidden rounded px-1.5 py-0.5 text-[11px] leading-tight shadow-sm ${movable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"} ${isDrag ? "z-20 opacity-80 ring-2 ring-ink" : "z-10"} ${ext ? "opacity-50" : ""}`}
        style={{
          top: pl.top + dTop, height: pl.height,
          left: `calc(${(pl.col / pl.cols) * 100}% + ${dLeft}% + 1px)`, width: `calc(${100 / pl.cols}% - 3px)`,
          background: ext ? "transparent" : `${colour}22`, borderLeft: `3px solid ${colour}`,
          border: ext ? `1px dashed ${colour}` : undefined, touchAction: "none",
        }}
        title={`${e.title} · ${SOURCE_LABEL[e.source_type]}${movable ? " · drag to move" : ""}`}>
        <div className="truncate font-medium text-ink">{e.title}</div>
        {pl.height > 30 ? (
          <div className="truncate text-clay">
            {fmtTime(e.start_ts, p.tz)}{e.end_ts ? `–${fmtTime(e.end_ts, p.tz)}` : ""}
            {p.entityNames && e.entity_id && p.entityNames[e.entity_id] ? ` · ${p.entityNames[e.entity_id]}` : ""}
          </div>
        ) : null}
      </div>
    );
  };

  const allDayFor = (ymd: string) => visible.filter((e) => e.all_day && eventDays(e, p.tz).includes(ymd));
  const anyAllDay = days.some((d) => allDayFor(d).length);

  const grid = (
    <div className="mt-3 rounded border border-black/10 bg-white">
      <div className="grid border-b border-black/10" style={{ gridTemplateColumns: `3rem repeat(${days.length}, minmax(0,1fr))` }}>
        <div />
        {days.map((d) => (
          <button key={d} onClick={() => { setAnchor(d); setView("day"); }}
            className={`border-l border-black/5 px-2 py-1.5 text-left text-xs ${d === p.todayYmd ? "font-semibold text-tomato" : "text-ink-soft"}`}>
            {dayLabel(d, p.tz)}
          </button>
        ))}
      </div>
      {anyAllDay ? (
        <div className="grid border-b border-black/10" style={{ gridTemplateColumns: `3rem repeat(${days.length}, minmax(0,1fr))` }}>
          <div className="px-1 py-1 font-mono text-[9px] uppercase text-clay">all day</div>
          {days.map((d) => (
            <div key={d} className="space-y-0.5 border-l border-black/5 p-0.5">
              {allDayFor(d).map((e) => (
                <button key={e.id} onClick={() => setSelected(e)}
                  className={`block w-full truncate rounded px-1 py-0.5 text-left text-[11px] ${e.source_type === "external" ? "opacity-50" : ""}`}
                  style={{ background: `${eventColour(e)}22`, borderLeft: `3px solid ${eventColour(e)}` }}>
                  {e.title}
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : null}
      <div ref={scrollRef} className="relative max-h-[70vh] overflow-y-auto">
        <div className="grid" style={{ gridTemplateColumns: `3rem repeat(${days.length}, minmax(0,1fr))` }}>
          <div className="relative" style={{ height: 24 * HOUR_PX }}>
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="absolute right-1 -translate-y-1.5 font-mono text-[10px] text-clay" style={{ top: h * HOUR_PX }}>
                {h ? `${String(h).padStart(2, "0")}:00` : ""}
              </div>
            ))}
          </div>
          <div ref={gridRef} className="relative col-span-full col-start-2 grid" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0,1fr))` }}>
            {days.map((d, i) => (
              <div key={d} className="relative border-l border-black/5" style={{ height: 24 * HOUR_PX }}
                onDoubleClick={(ev) => { if (ev.target === ev.currentTarget) onGridDoubleClick(ev, d); }}>
                {Array.from({ length: 24 }, (_, h) => (
                  <div key={h} className="pointer-events-none absolute inset-x-0 border-t border-black/5" style={{ top: h * HOUR_PX }} />
                ))}
                {d === nowParts.ymd ? (
                  <div className="pointer-events-none absolute inset-x-0 z-30 border-t-2 border-tomato"
                    style={{ top: (nowParts.hour + nowParts.minute / 60) * HOUR_PX }} />
                ) : null}
                {placeDay(visible, d, p.tz).map((pl) => block(pl, i))}
              </div>
            ))}
          </div>
        </div>
      </div>
      <p className="border-t border-black/5 px-2 py-1 text-[10px] text-clay">
        Double-click an empty slot for a meeting · drag shifts, interviews, tasks, events and unapproved posts to move them · bookings, prep and HACCP are fixed here.
      </p>
    </div>
  );

  const agenda = (
    <div className="mt-3 space-y-4">
      {days.map((d) => {
        const list = visible.filter((e) => eventDays(e, p.tz).includes(d))
          .sort((a, b) => Number(b.all_day) - Number(a.all_day) || a.start_ts.localeCompare(b.start_ts));
        if (!list.length) return null;
        return (
          <section key={d}>
            <h3 className={`font-mono text-[11px] uppercase tracking-wide ${d === p.todayYmd ? "text-tomato" : "text-clay"}`}>{dayLabel(d, p.tz)}</h3>
            <ul className="mt-1 divide-y divide-black/5 rounded border border-black/10 bg-white">
              {list.map((e) => (
                <li key={e.id}>
                  <button onClick={() => setSelected(e)} className={`flex w-full items-baseline gap-3 px-3 py-2 text-left text-sm ${e.source_type === "external" ? "opacity-50" : ""}`}>
                    <span className="w-24 shrink-0 font-mono text-xs tabular-nums text-clay">
                      {e.all_day ? "all day" : `${fmtTime(e.start_ts, p.tz)}${e.end_ts ? `–${fmtTime(e.end_ts, p.tz)}` : ""}`}
                    </span>
                    <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: eventColour(e) }} />
                    <span className="min-w-0 flex-1 truncate">{e.title}</span>
                    <span className="shrink-0 text-[11px] text-clay">
                      {SOURCE_LABEL[e.source_type]}{p.entityNames && e.entity_id && p.entityNames[e.entity_id] ? ` · ${p.entityNames[e.entity_id]}` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {!visible.length ? <p className="text-sm text-clay">Nothing in the next two weeks.</p> : null}
    </div>
  );

  return (
    <div>
      {header}
      {chips}
      {view === "agenda" ? agenda : grid}
      {selected ? <Detail e={selected} tz={p.tz} people={people} slugs={p.entitySlugs || {}}
        onClose={() => setSelected(null)}
        onDeleted={(id) => { setEvents((xs) => xs.filter((x) => x.id !== id)); setSelected(null); }} /> : null}
      {creating ? <CreateMeeting start={creating.start} end={creating.end} tz={p.tz} entityId={p.scope.entityId || null}
        onClose={() => setCreating(null)}
        onCreated={(e) => { setEvents((xs) => [...xs, e]); setCreating(null); setToast("Meeting added"); }} /> : null}
      {toast ? (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded bg-ink px-3 py-2 text-xs text-white shadow">{toast}</div>
      ) : null}
    </div>
  );
}

function Detail({ e, tz, people, slugs, onClose, onDeleted }: {
  e: CalEvent; tz: string; people: Record<string, string>; slugs: Record<string, string>;
  onClose: () => void; onDeleted: (id: string) => void;
}) {
  const href = sourceHref(e, slugs);
  const when = e.all_day
    ? dayLabel(zonedParts(e.start_ts, tz).ymd, tz)
    : `${dayLabel(zonedParts(e.start_ts, tz).ymd, tz)} · ${fmtTime(e.start_ts, tz)}${e.end_ts ? `–${fmtTime(e.end_ts, tz)}` : ""}`;
  const del = async () => {
    const r = await fetch(`/api/events/${e.id}`, { method: "DELETE" });
    const j = await r.json().catch(() => ({}));
    if (j.ok) onDeleted(e.id);
  };
  return (
    <aside className="fixed inset-y-0 right-0 z-40 w-full max-w-sm overflow-y-auto border-l border-black/10 bg-paper p-5 shadow-xl">
      <div className="flex items-start justify-between gap-2">
        <p className="font-mono text-[10px] uppercase tracking-wide" style={{ color: eventColour(e) }}>{SOURCE_LABEL[e.source_type]}{e.status ? ` · ${e.status}` : ""}</p>
        <button onClick={onClose} className="text-clay" aria-label="Close">✕</button>
      </div>
      <h2 className="mt-1 font-serif text-xl">{e.title}</h2>
      <p className="mt-1 text-sm">{when}</p>
      {e.location ? <p className="mt-1 text-sm text-clay">{e.location}</p> : null}
      {e.person_ids?.length ? (
        <p className="mt-2 text-sm">{e.person_ids.map((i) => people[i] || "—").join(", ")}</p>
      ) : null}
      {e.description ? <p className="mt-3 whitespace-pre-wrap text-sm text-ink-soft">{e.description}</p> : null}
      <div className="mt-4 flex flex-wrap gap-2 text-xs">
        {href ? <Link href={href} className="rounded border border-black/15 px-2 py-1">Open source →</Link> : null}
        {e.source_type === "meeting" ? <button onClick={del} className="rounded border border-tomato/40 px-2 py-1 text-tomato">Delete meeting</button> : null}
        {!canReschedule(e) && e.source_type !== "external" ? <span className="py-1 text-clay">Fixed here — change it at source.</span> : null}
      </div>
    </aside>
  );
}

function CreateMeeting({ start, end, tz, entityId, onClose, onCreated }: {
  start: Date; end: Date; tz: string; entityId: string | null; onClose: () => void; onCreated: (e: CalEvent) => void;
}) {
  const [title, setTitle] = useState("");
  const [loc, setLoc] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const save = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!title.trim()) return;
    const r = await fetch("/api/events", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, location: loc || null, start_ts: start.toISOString(), end_ts: end.toISOString(), entity_id: entityId }),
    });
    const j = await r.json().catch(() => ({}));
    if (j.ok) onCreated(j.event); else setErr(j.error || "Not saved");
  };
  return (
    <aside className="fixed inset-y-0 right-0 z-40 w-full max-w-sm border-l border-black/10 bg-paper p-5 shadow-xl">
      <form onSubmit={save} className="space-y-3">
        <div className="flex items-start justify-between">
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">New meeting · {dayLabel(zonedParts(start.toISOString(), tz).ymd, tz)} {fmtTime(start.toISOString(), tz)}–{fmtTime(end.toISOString(), tz)}</p>
          <button type="button" onClick={onClose} className="text-clay">✕</button>
        </div>
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title"
          className="w-full rounded border border-black/15 bg-white px-2 py-1.5 text-sm" />
        <input value={loc} onChange={(e) => setLoc(e.target.value)} placeholder="Where (optional)"
          className="w-full rounded border border-black/15 bg-white px-2 py-1.5 text-sm" />
        {err ? <p className="text-xs text-tomato">{err}</p> : null}
        <button className="rounded bg-ink px-3 py-1.5 text-xs text-white">Add</button>
      </form>
    </aside>
  );
}
