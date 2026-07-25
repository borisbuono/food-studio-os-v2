"use client";
import { useEffect, useState } from "react";

// Home compass — "Today's Brief" panel.
// Sits above the daily-loop timeline. Reads /api/assistant/brief/generate,
// which is idempotent per (entity, user, date). Polish #2 upgraded the
// backend to weave email / WhatsApp / payments / reviews / memory into
// the brief, so this panel now renders a richer object:
//   - headline    — one sentence, kicker-serif
//   - body        — 4-6 editorial paragraphs
//   - signals     — priorities / signals / money / handled shown as
//                   micro-labels under hairline dividers
//
// Editorial identity: font-serif prose, no cards, hairline dividers, per-
// entity accent (via --accent) for the section labels + regenerate action.

type BriefSignal   = { source: string; label: string; count: number; priority?: number };
type BriefPriority = { label: string; source: string; count?: number; amount_eur?: number };
type BriefMoney    = { open_invoices: number; open_invoices_eur: number; unmatched_bank: number; failing_platforms: number; failing_labels: string[] };
type BriefHandled  = { source: string; label: string; count: number };
type BriefSignals  = {
  today: { date: string; now_hhmm: string; covers_booked: number; service_phase: string; upcoming_bookings: { time: string; party: number; name: string | null }[] };
  yesterday: { date: string; eod_posted: boolean; eod_revenue: number | null; eod_deviation: string | null };
  priorities: BriefPriority[];
  signals: BriefSignal[];
  money: BriefMoney;
  handled: BriefHandled[];
  memory_highlights: { fact: string; kind: string | null }[];
};

type Brief = {
  id: string;
  entity_code: string;
  date: string;
  headline?: string | null;
  body: string | null;
  signals?: BriefSignals | null;
};

const SOURCE_LABEL: Record<string, string> = {
  email: "email",
  whatsapp: "whatsapp",
  review: "reviews",
  payment: "payments",
  memory: "memory",
  service: "service",
  money: "money",
  eod: "eod",
};

export default function AssistantBriefPanel({ entity }: { entity: string }) {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setErr(null);
      try {
        const r = await fetch("/api/assistant/brief/generate", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ entity }),
        });
        const d = await r.json();
        if (cancelled) return;
        if (d.ok) setBrief(d.brief);
        else setErr(d.error || "brief unavailable");
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || "brief unavailable");
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [entity]);

  const regenerate = async () => {
    setRefreshing(true); setErr(null);
    try {
      const r = await fetch("/api/assistant/brief/generate", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ entity, force: true }),
      });
      const d = await r.json();
      if (d.ok) setBrief(d.brief); else setErr(d.error || "regenerate failed");
    } catch (e: any) { setErr(e?.message || "regenerate failed"); }
    setRefreshing(false);
  };

  const signals = brief?.signals || null;
  const paragraphs = (brief?.body || "").split(/\n\n+/).map((p) => p.trim()).filter(Boolean);

  return (
    <section
      className="mt-6 rounded-r-lg border-l-2 bg-paper-deep/40 px-4 py-4 sm:px-5"
      style={{ borderLeftColor: "var(--accent)" }}
      aria-label="Today's brief from Chef"
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-mono text-[10px] uppercase tracking-wide" style={{ color: "var(--accent)" }}>Chef · Today&apos;s brief</p>
        <button
          onClick={regenerate}
          disabled={refreshing || loading}
          className="font-mono text-[10px] uppercase tracking-wide disabled:opacity-40"
          style={{ color: "var(--accent)" }}
        >
          {refreshing ? "regenerating…" : "regenerate ›"}
        </button>
      </div>

      {loading ? (
        <p className="mt-3 font-serif italic text-[14px] text-muted">Writing the shape of your day…</p>
      ) : err && !brief ? (
        <p className="mt-3 font-serif italic text-[14px] text-muted">{err}. Tap regenerate to try again.</p>
      ) : brief ? (
        <>
          {brief.headline ? (
            <p className="mt-3 font-serif text-[19px] leading-snug text-ink">{brief.headline}</p>
          ) : null}

          {paragraphs.length ? (
            <div className="mt-4 space-y-3">
              {paragraphs.map((para, i) => (
                <p key={i} className="font-serif text-[16px] leading-relaxed text-ink-soft">{para}</p>
              ))}
            </div>
          ) : (
            <p className="mt-3 font-serif italic text-[14px] text-muted">No brief yet — the day is still unwritten.</p>
          )}

          {signals && signals.priorities.length ? (
            <div className="mt-6 border-t border-black/10 pt-3">
              <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Priorities</p>
              <ul className="mt-2 divide-y divide-black/5">
                {signals.priorities.map((p, i) => (
                  <li key={i} className="flex items-baseline justify-between gap-3 py-2">
                    <span className="font-serif text-[14px] text-ink">{p.label}</span>
                    <span className="font-mono text-[10px] uppercase tracking-wide text-clay">{SOURCE_LABEL[p.source] || p.source}{p.amount_eur ? ` · €${p.amount_eur}` : ""}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {signals && signals.signals.length ? (
            <div className="mt-4 border-t border-black/10 pt-3">
              <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Overnight signals</p>
              <ul className="mt-2 divide-y divide-black/5">
                {signals.signals.map((s, i) => (
                  <li key={i} className="flex items-baseline justify-between gap-3 py-2">
                    <span className="font-serif text-[14px] text-ink">{s.label}</span>
                    <span className="font-mono text-[10px] uppercase tracking-wide" style={{ color: s.priority && s.priority <= 1 ? "var(--accent)" : undefined }}>{SOURCE_LABEL[s.source] || s.source}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {signals && (signals.money.open_invoices || signals.money.unmatched_bank || signals.money.failing_platforms) ? (
            <div className="mt-4 border-t border-black/10 pt-3">
              <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Money</p>
              <ul className="mt-2 divide-y divide-black/5">
                {signals.money.open_invoices > 0 && (
                  <li className="flex items-baseline justify-between gap-3 py-2">
                    <span className="font-serif text-[14px] text-ink">{signals.money.open_invoices} invoice{signals.money.open_invoices > 1 ? "s" : ""} waiting</span>
                    <span className="font-mono text-[10px] text-clay">€{signals.money.open_invoices_eur}</span>
                  </li>
                )}
                {signals.money.unmatched_bank > 0 && (
                  <li className="flex items-baseline justify-between gap-3 py-2">
                    <span className="font-serif text-[14px] text-ink">{signals.money.unmatched_bank} bank movement{signals.money.unmatched_bank > 1 ? "s" : ""} unmatched</span>
                    <span className="font-mono text-[10px] uppercase tracking-wide text-clay">bank</span>
                  </li>
                )}
                {signals.money.failing_platforms > 0 && (
                  <li className="flex items-baseline justify-between gap-3 py-2">
                    <span className="font-serif text-[14px] text-ink">{signals.money.failing_labels.slice(0, 3).join(", ")}</span>
                    <span className="font-mono text-[10px] uppercase tracking-wide" style={{ color: "var(--accent)" }}>payments</span>
                  </li>
                )}
              </ul>
            </div>
          ) : null}

          {signals && signals.handled.length ? (
            <div className="mt-4 border-t border-black/10 pt-3">
              <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Already in hand</p>
              <ul className="mt-2 divide-y divide-black/5">
                {signals.handled.map((h, i) => (
                  <li key={i} className="flex items-baseline justify-between gap-3 py-2">
                    <span className="font-serif italic text-[14px] text-ink-soft">{h.label}</span>
                    <span className="font-mono text-[10px] uppercase tracking-wide text-clay">{SOURCE_LABEL[h.source] || h.source}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : (
        <p className="mt-3 font-serif italic text-[14px] text-muted">No brief yet — the day is still unwritten.</p>
      )}
    </section>
  );
}
