"use client";
import { useEffect, useState } from "react";

// Home compass — "Today's Brief" panel.
// Sits above the daily-loop timeline. Reads /api/assistant/brief/generate
// which is idempotent per (entity, user, date): first call runs the model
// and stores; subsequent calls return the cached row until Refresh is hit.
//
// Editorial identity: font-serif prose, hairline top, per-entity accent for
// the kicker + refresh action. No cards, no bullets.

type Brief = { id: string; entity_code: string; date: string; body: string; created_at: string };

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

  const refresh = async () => {
    setRefreshing(true); setErr(null);
    try {
      const r = await fetch("/api/assistant/brief/generate", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ entity, force: true }),
      });
      const d = await r.json();
      if (d.ok) setBrief(d.brief); else setErr(d.error || "refresh failed");
    } catch (e: any) { setErr(e?.message || "refresh failed"); }
    setRefreshing(false);
  };

  return (
    <section className="mt-6 border-t border-black/10 pt-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Today&apos;s brief</p>
        <button
          onClick={refresh}
          disabled={refreshing || loading}
          className="font-mono text-[10px] uppercase tracking-wide disabled:opacity-40"
          style={{ color: "var(--accent)" }}
        >
          {refreshing ? "refreshing…" : "refresh ›"}
        </button>
      </div>

      {loading ? (
        <p className="mt-3 font-serif italic text-[14px] text-muted">Writing the shape of your day…</p>
      ) : err && !brief ? (
        <p className="mt-3 font-serif italic text-[14px] text-muted">{err}. Tap refresh to try again.</p>
      ) : brief?.body ? (
        <div className="mt-3 space-y-3">
          {brief.body.split(/\n\n+/).map((para, i) => (
            <p key={i} className="font-serif text-[16px] leading-relaxed text-ink-soft">{para.trim()}</p>
          ))}
        </div>
      ) : (
        <p className="mt-3 font-serif italic text-[14px] text-muted">No brief yet — the day is still unwritten.</p>
      )}
    </section>
  );
}
