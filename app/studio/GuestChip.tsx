"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

// Small inline guest-count chip for a venue card.
//
// Boris rule 2026-08-31 18:15 CET: show BOTH tickets (Fresto z.quantity)
// AND guests (real physical guest count) on venue cards. Never conflate.
//
// States:
//   • guests set        → "60 guests · manual"  (or ·email)
//   • guests null       → "key guests" [click to reveal inline input]
//
// Manual key trumps email — this chip always writes guests_source='manual'.
// Owner-side only; RLS on /api/eod/guests handles server-side auth.

export function GuestChip(props: {
  restaurant_id: string;
  date: string;
  initialGuests: number | null;
  initialSource: string | null;
}) {
  const router = useRouter();
  const [guests, setGuests] = useState<number | null>(props.initialGuests);
  const [source, setSource] = useState<string | null>(props.initialSource);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<string>(guests == null ? "" : String(guests));
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    setErr(null);
    const n = value.trim() === "" ? null : Number(value);
    if (n != null && (!Number.isFinite(n) || n < 0 || n > 9999)) {
      setErr("0–9999"); return;
    }
    startTransition(async () => {
      try {
        const r = await fetch("/api/eod/guests", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            restaurant_id: props.restaurant_id,
            date: props.date,
            guests: n,
          }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j?.ok) { setErr(j?.error || `error ${r.status}`); return; }
        setGuests(n);
        setSource(n == null ? null : "manual");
        setEditing(false);
        router.refresh();
      } catch (e: any) {
        setErr(e?.message || "failed");
      }
    });
  }

  // Prevent the parent Link from navigating when the chip is clicked.
  function stop(e: React.MouseEvent) { e.preventDefault(); e.stopPropagation(); }

  if (editing) {
    return (
      <form onSubmit={submit} onClick={stop} className="inline-flex items-center gap-1">
        <input
          autoFocus
          type="number"
          inputMode="numeric"
          min={0}
          max={9999}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") { setEditing(false); setValue(guests == null ? "" : String(guests)); } }}
          className="w-14 rounded border border-black/20 bg-paper px-1 py-0.5 font-mono text-[11px] text-ink outline-none focus:border-ink/60"
          disabled={pending}
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded border border-ink/40 bg-ink/5 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-ink hover:bg-ink/10"
        >
          {pending ? "…" : "save"}
        </button>
        {err ? <span className="font-mono text-[9px] text-red-700">{err}</span> : null}
      </form>
    );
  }

  if (guests == null) {
    return (
      <button
        type="button"
        onClick={(e) => { stop(e); setEditing(true); }}
        className="inline-flex items-center rounded-full border border-dashed border-black/30 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-clay hover:border-ink/50 hover:text-ink"
        title="No guest count on file — click to key one"
      >
        key guests
      </button>
    );
  }

  const label = source === "email" ? "email" : source === "import" ? "import" : "manual";
  return (
    <button
      type="button"
      onClick={(e) => { stop(e); setEditing(true); }}
      className="inline-flex items-center gap-1 rounded border border-black/10 px-2 py-0.5 font-mono text-[11px] text-ink hover:border-ink/40"
      title="Click to re-key"
    >
      <span>{guests} guests</span>
      <span className="text-clay">·</span>
      <span className="text-clay">{label}</span>
    </button>
  );
}
