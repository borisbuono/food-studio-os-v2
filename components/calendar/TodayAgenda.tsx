"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { SOURCE_LABEL, eventColour, zonedParts, type CalEvent } from "@/lib/calendar";

// Amie-model "today": one column, big timestamps. Events in time order,
// then todos — drag todos to reorder (order kept on this device per day),
// tick to complete. Tap anything to expand.

export type TodayTodo = {
  id: string; title: string; description: string | null; status: string;
  priority: number | null; due_at: string | null; entity_code: string | null;
};

function hhmm(iso: string, tz: string) {
  const p = zonedParts(iso, tz);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

export default function TodayAgenda({ tz, todayYmd, events, todos, entityNames }: {
  tz: string; todayYmd: string; events: CalEvent[]; todos: TodayTodo[]; entityNames: Record<string, string>;
}) {
  const key = `fs_today_order_${todayYmd}`;
  const [order, setOrder] = useState<string[]>(() => todos.map((t) => t.id));
  const [done, setDone] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) || "[]") as string[];
      if (Array.isArray(saved) && saved.length) {
        const ids = new Set(todos.map((t) => t.id));
        const kept = saved.filter((i) => ids.has(i));
        setOrder([...kept, ...todos.map((t) => t.id).filter((i) => !kept.includes(i))]);
      }
    } catch { /* storage unavailable — default order */ }
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, [key, todos]);

  const persist = (ids: string[]) => {
    setOrder(ids);
    try { localStorage.setItem(key, JSON.stringify(ids)); } catch { /* ignore */ }
  };

  const byId = useMemo(() => new Map(todos.map((t) => [t.id, t])), [todos]);
  const timed = events.filter((e) => !e.all_day).sort((a, b) => a.start_ts.localeCompare(b.start_ts));
  const allDay = events.filter((e) => e.all_day);
  const nextIdx = timed.findIndex((e) => new Date(e.end_ts || e.start_ts).getTime() >= now);

  const complete = async (id: string) => {
    setDone((d) => new Set(d).add(id));
    const r = await fetch(`/api/master-todo?id=${id}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "completed" }),
    }).catch(() => null);
    if (!r || !r.ok) setDone((d) => { const n = new Set(d); n.delete(id); return n; });
  };

  const dateLabel = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "long", day: "numeric", month: "long" }).format(new Date());

  return (
    <div>
      <div className="flex items-end justify-between border-b border-black/10 pb-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Today</p>
          <h1 className="font-serif text-3xl">{dateLabel}</h1>
        </div>
        <Link href="/me/calendar" className="rounded border border-black/15 px-2 py-1 text-xs">Week →</Link>
      </div>

      {allDay.length ? (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {allDay.map((e) => (
            <span key={e.id} className="rounded px-2 py-0.5 text-xs" style={{ background: `${eventColour(e)}22`, borderLeft: `3px solid ${eventColour(e)}` }}>
              {e.title}
            </span>
          ))}
        </div>
      ) : null}

      <ol className="mt-4 space-y-2">
        {timed.map((e, i) => {
          const past = new Date(e.end_ts || e.start_ts).getTime() < now;
          const isOpen = open === e.id;
          return (
            <li key={e.id}>
              <button onClick={() => setOpen(isOpen ? null : e.id)}
                className={`flex w-full items-start gap-4 rounded border bg-white px-4 py-3 text-left ${i === nextIdx ? "border-ink" : "border-black/10"} ${past ? "opacity-50" : ""} ${e.source_type === "external" ? "border-dashed" : ""}`}>
                <span className="w-16 shrink-0 font-mono text-2xl tabular-nums leading-none">{hhmm(e.start_ts, tz)}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="inline-block h-2 w-2 rounded-full" style={{ background: eventColour(e) }} />
                    <span className="truncate text-base">{e.title}</span>
                  </span>
                  <span className="mt-0.5 block text-xs text-clay">
                    {e.end_ts ? `until ${hhmm(e.end_ts, tz)} · ` : ""}{SOURCE_LABEL[e.source_type]}
                    {e.entity_id && entityNames[e.entity_id] ? ` · ${entityNames[e.entity_id]}` : ""}
                    {e.location ? ` · ${e.location}` : ""}
                  </span>
                  {isOpen && e.description ? <span className="mt-2 block whitespace-pre-wrap text-sm text-ink-soft">{e.description}</span> : null}
                </span>
              </button>
            </li>
          );
        })}
        {!timed.length ? <li className="text-sm text-clay">Nothing booked in for you today.</li> : null}
      </ol>

      <h2 className="mt-8 font-mono text-[11px] uppercase tracking-wide text-clay">To do</h2>
      <ul className="mt-2 space-y-1.5">
        {order.map((id) => byId.get(id)).filter(Boolean).map((t) => {
          const td = t as TodayTodo;
          const isDone = done.has(td.id);
          const overdue = td.due_at && new Date(td.due_at).getTime() < now;
          return (
            <li key={td.id} draggable
              onDragStart={() => setDragId(td.id)}
              onDragOver={(ev) => ev.preventDefault()}
              onDrop={() => {
                if (!dragId || dragId === td.id) return;
                const ids = order.filter((x) => x !== dragId);
                ids.splice(ids.indexOf(td.id), 0, dragId);
                persist(ids); setDragId(null);
              }}
              className={`flex items-start gap-3 rounded border border-black/10 bg-white px-3 py-2 ${isDone ? "opacity-40" : ""} ${dragId === td.id ? "ring-1 ring-ink" : ""}`}>
              <input type="checkbox" checked={isDone} disabled={isDone} onChange={() => complete(td.id)} className="mt-1" aria-label="Done" />
              <button onClick={() => setOpen(open === td.id ? null : td.id)} className="min-w-0 flex-1 text-left">
                <span className={`block ${isDone ? "line-through" : ""}`}>{td.title}</span>
                <span className="block text-[11px] text-clay">
                  {td.entity_code || ""}{td.due_at ? ` · due ${hhmm(td.due_at, tz)}${overdue ? " (overdue)" : ""}` : ""}
                </span>
                {open === td.id && td.description ? <span className="mt-1 block whitespace-pre-wrap text-sm text-ink-soft">{td.description}</span> : null}
              </button>
              <span className="cursor-grab select-none text-clay" title="Drag to reorder">⋮⋮</span>
            </li>
          );
        })}
        {!todos.length ? <li className="text-sm text-clay">No open tasks assigned to you.</li> : null}
      </ul>
    </div>
  );
}
