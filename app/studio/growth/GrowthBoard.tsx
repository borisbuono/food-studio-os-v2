"use client";

import { useMemo, useState, useTransition } from "react";

type LeadRow = {
  id: string;
  entity_id: string | null;
  source: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  party_size: number | null;
  intent: string | null;
  requested_date: string | null;
  message: string | null;
  state: string;
  created_at: string;
  updated_at: string;
  assigned_to: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  landing_url: string | null;
  referrer_url: string | null;
};

type EntityRow = { id: string; name: string; entity_type: string | null };

type Touch = {
  id: string;
  touched_at: string;
  channel: string | null;
  direction: string | null;
  notes: string | null;
  by_user: string | null;
};

const COLUMNS: Array<{ id: string; label: string }> = [
  { id: "new",       label: "New" },
  { id: "contacted", label: "Contacted" },
  { id: "qualified", label: "Qualified" },
  { id: "converted", label: "Converted" },
  { id: "lost",      label: "Lost" },
];

const NEXT_STATE: Record<string, string> = {
  new: "contacted",
  contacted: "qualified",
  qualified: "converted",
};

function shortDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  } catch { return iso; }
}
function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const secs = Math.max(0, Math.floor((now - then) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

export default function GrowthBoard({
  leads: initialLeads,
  entities,
}: {
  leads: LeadRow[];
  entities: EntityRow[];
}) {
  const [leads, setLeads] = useState<LeadRow[]>(initialLeads);
  const [entityFilter, setEntityFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [touches, setTouches] = useState<Touch[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const entityById = useMemo(() => {
    const m = new Map<string, EntityRow>();
    for (const e of entities) m.set(e.id, e);
    return m;
  }, [entities]);

  const sources = useMemo(() => {
    const s = new Set<string>();
    for (const l of leads) if (l.source) s.add(l.source);
    return Array.from(s).sort();
  }, [leads]);

  const filtered = useMemo(() => {
    return leads.filter((l) => {
      if (entityFilter !== "all") {
        if (entityFilter === "unassigned") { if (l.entity_id) return false; }
        else if (l.entity_id !== entityFilter) return false;
      }
      if (sourceFilter !== "all" && l.source !== sourceFilter) return false;
      return true;
    });
  }, [leads, entityFilter, sourceFilter]);

  const byColumn = useMemo(() => {
    const m = new Map<string, LeadRow[]>();
    for (const c of COLUMNS) m.set(c.id, []);
    for (const l of filtered) {
      const col = m.get(l.state) ?? m.get("new");
      col!.push(l);
    }
    return m;
  }, [filtered]);

  async function loadTouches(leadId: string) {
    // Use the list endpoint's shape and re-read the lead + touches. We keep
    // this simple: fetch lead_touches via a supabase call would require a
    // client key, so we route through a small helper endpoint. For now the
    // drawer opens with an empty timeline and touches populate as the user
    // adds them (state transitions and manual touches both re-fetch).
    try {
      const res = await fetch(`/api/leads/${leadId}/timeline`, { cache: "no-store" });
      if (!res.ok) { setTouches([]); return; }
      const j = await res.json();
      setTouches(Array.isArray(j.rows) ? j.rows : []);
    } catch {
      setTouches([]);
    }
  }

  function openLead(id: string) {
    setOpenId(id);
    setTouches([]);
    setError(null);
    loadTouches(id);
  }

  async function advance(leadId: string, toState: string) {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/leads/${leadId}/state`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state: toState }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "state change failed");
      }
      // Optimistically move the card.
      setLeads((prev) => prev.map((l) => (l.id === leadId ? { ...l, state: toState, updated_at: new Date().toISOString() } : l)));
      if (openId === leadId) startTransition(() => loadTouches(leadId));
    } catch (e: any) {
      setError(e?.message || "state change failed");
    } finally {
      setBusy(false);
    }
  }

  async function markLost(leadId: string, reason: string) {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/leads/${leadId}/state`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state: "lost", lost_reason: reason }),
      });
      if (!res.ok) throw new Error("failed");
      setLeads((prev) => prev.map((l) => (l.id === leadId ? { ...l, state: "lost", updated_at: new Date().toISOString() } : l)));
      if (openId === leadId) startTransition(() => loadTouches(leadId));
    } catch (e: any) {
      setError(e?.message || "failed");
    } finally { setBusy(false); }
  }

  async function logTouch(leadId: string, channel: string, direction: string, notes: string) {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/leads/${leadId}/touch`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channel, direction, notes }),
      });
      if (!res.ok) throw new Error("touch failed");
      startTransition(() => loadTouches(leadId));
    } catch (e: any) {
      setError(e?.message || "touch failed");
    } finally { setBusy(false); }
  }

  const open = openId ? leads.find((l) => l.id === openId) || null : null;

  return (
    <div>
      {/* Filter chips */}
      <div className="mb-4 flex flex-wrap gap-2 items-center">
        <span className="text-xs text-slate-500 uppercase tracking-wide">Filter</span>
        <select
          value={entityFilter}
          onChange={(e) => setEntityFilter(e.target.value)}
          className="text-sm rounded-md border border-slate-300 bg-white px-2 py-1"
        >
          <option value="all">Every venue</option>
          <option value="unassigned">Unassigned</option>
          {entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          className="text-sm rounded-md border border-slate-300 bg-white px-2 py-1"
        >
          <option value="all">Every source</option>
          {sources.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {error ? <span className="text-xs text-red-600">{error}</span> : null}
      </div>

      {/* Kanban columns */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        {COLUMNS.map((col) => {
          const rows = byColumn.get(col.id) || [];
          return (
            <div key={col.id} className="bg-white border border-slate-200 rounded-md">
              <div className="px-3 py-2 border-b border-slate-100 flex items-baseline justify-between">
                <div className="text-xs uppercase tracking-wide text-slate-600">{col.label}</div>
                <div className="text-xs text-slate-400">{rows.length}</div>
              </div>
              <div className="p-2 space-y-2 min-h-[80px]">
                {rows.length === 0 ? (
                  <div className="text-xs text-slate-400 py-6 text-center">Empty</div>
                ) : null}
                {rows.map((l) => {
                  const ent = l.entity_id ? entityById.get(l.entity_id) : null;
                  return (
                    <button
                      key={l.id}
                      onClick={() => openLead(l.id)}
                      className="w-full text-left rounded-md border border-slate-200 hover:border-slate-400 px-3 py-2 bg-slate-50 hover:bg-white transition"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <div className="text-sm font-medium truncate">{l.name || l.email || l.phone || "(no name)"}</div>
                        <div className="text-[10px] text-slate-400 shrink-0">{timeAgo(l.created_at)}</div>
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5 flex flex-wrap gap-x-2">
                        {ent ? <span>{ent.name}</span> : <span className="italic">no venue</span>}
                        {l.intent ? <span>· {l.intent}</span> : null}
                        {l.requested_date ? <span>· {shortDate(l.requested_date)}</span> : null}
                        {l.source ? <span>· {l.source}</span> : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Drawer */}
      {open ? (
        <div className="fixed inset-0 z-50 bg-black/30" onClick={() => setOpenId(null)}>
          <aside
            className="absolute right-0 top-0 bottom-0 w-full max-w-lg bg-white shadow-xl overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6">
              <div className="flex items-baseline justify-between mb-4">
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">
                    {(open.entity_id && entityById.get(open.entity_id)?.name) || "No venue"}
                  </div>
                  <h2 className="text-xl font-serif">{open.name || "(no name)"}</h2>
                </div>
                <button onClick={() => setOpenId(null)} className="text-slate-500 text-sm underline">Close</button>
              </div>

              <dl className="grid grid-cols-2 gap-y-2 text-sm mb-6">
                <dt className="text-slate-500">State</dt>
                <dd className="uppercase text-xs tracking-wide">{open.state}</dd>
                <dt className="text-slate-500">Email</dt>
                <dd>{open.email || "—"}</dd>
                <dt className="text-slate-500">Phone</dt>
                <dd>{open.phone || "—"}</dd>
                <dt className="text-slate-500">Party size</dt>
                <dd>{open.party_size ?? "—"}</dd>
                <dt className="text-slate-500">Intent</dt>
                <dd>{open.intent || "—"}</dd>
                <dt className="text-slate-500">Requested date</dt>
                <dd>{open.requested_date || "—"}</dd>
                <dt className="text-slate-500">Source</dt>
                <dd>{open.source || "—"}</dd>
                <dt className="text-slate-500">UTM</dt>
                <dd className="truncate">{[open.utm_source, open.utm_medium, open.utm_campaign].filter(Boolean).join(" · ") || "—"}</dd>
                <dt className="text-slate-500">Landing</dt>
                <dd className="truncate">{open.landing_url || "—"}</dd>
                <dt className="text-slate-500">Created</dt>
                <dd>{new Date(open.created_at).toLocaleString("en-GB")}</dd>
              </dl>

              {open.message ? (
                <div className="mb-6">
                  <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Message</div>
                  <p className="text-sm whitespace-pre-wrap bg-slate-50 rounded-md p-3">{open.message}</p>
                </div>
              ) : null}

              {/* Actions */}
              <div className="mb-6 flex flex-wrap gap-2">
                {NEXT_STATE[open.state] ? (
                  <button
                    disabled={busy}
                    onClick={() => advance(open.id, NEXT_STATE[open.state])}
                    className="text-xs uppercase tracking-wide rounded-md bg-slate-900 text-white px-3 py-1.5 disabled:opacity-50"
                  >
                    Advance → {NEXT_STATE[open.state]}
                  </button>
                ) : null}
                {open.state !== "lost" && open.state !== "converted" ? (
                  <button
                    disabled={busy}
                    onClick={() => {
                      const r = prompt("Reason lost:");
                      if (r) markLost(open.id, r);
                    }}
                    className="text-xs uppercase tracking-wide rounded-md border border-slate-300 px-3 py-1.5 disabled:opacity-50"
                  >
                    Mark lost
                  </button>
                ) : null}
              </div>

              <div className="mb-4">
                <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">Log a touch</div>
                <TouchLogger disabled={busy} onSubmit={(ch, dir, notes) => logTouch(open.id, ch, dir, notes)} />
              </div>

              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">Timeline</div>
                {touches.length === 0 ? (
                  <div className="text-sm text-slate-400">No touches yet.</div>
                ) : (
                  <ol className="space-y-2">
                    {touches.map((t) => (
                      <li key={t.id} className="text-sm border-l-2 border-slate-200 pl-3">
                        <div className="text-[11px] text-slate-500">
                          {new Date(t.touched_at).toLocaleString("en-GB")} · {t.channel || "—"} · {t.direction || "—"}
                        </div>
                        {t.notes ? <div className="text-slate-800">{t.notes}</div> : null}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}

function TouchLogger({
  onSubmit,
  disabled,
}: {
  onSubmit: (channel: string, direction: string, notes: string) => void;
  disabled: boolean;
}) {
  const [channel, setChannel] = useState("email");
  const [direction, setDirection] = useState("outbound");
  const [notes, setNotes] = useState("");
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <select value={channel} onChange={(e) => setChannel(e.target.value)} className="text-sm rounded-md border border-slate-300 bg-white px-2 py-1">
          <option value="email">Email</option>
          <option value="whatsapp">WhatsApp</option>
          <option value="call">Call</option>
          <option value="in-person">In person</option>
        </select>
        <select value={direction} onChange={(e) => setDirection(e.target.value)} className="text-sm rounded-md border border-slate-300 bg-white px-2 py-1">
          <option value="outbound">Outbound</option>
          <option value="inbound">Inbound</option>
          <option value="internal">Internal note</option>
        </select>
      </div>
      <textarea
        rows={2}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes"
        className="w-full text-sm rounded-md border border-slate-300 px-2 py-1"
      />
      <button
        disabled={disabled}
        onClick={() => { if (!disabled) { onSubmit(channel, direction, notes); setNotes(""); } }}
        className="text-xs uppercase tracking-wide rounded-md bg-slate-800 text-white px-3 py-1.5 disabled:opacity-50"
      >
        Log
      </button>
    </div>
  );
}
