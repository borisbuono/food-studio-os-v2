"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

// ManualEodClient — number-pad friendly manual EOD entry.
//
// Rules:
//  * Trading date defaults to yesterday (Madrid).
//  * Money fields are gross (VAT-inclusive) — Boris keys what's on the ticket.
//  * Totals recompute live.
//  * A "Missing days" chip strip lists the last 30 days with no eod_pos row
//    for this entity so the operator can back-fill (manager+ only via PATCH).
//  * On submit the client POSTs /api/eod/manual — the server upserts the row.

type Props = {
  entityId: string;
  houseSlug: string;
  today: string; // Madrid YYYY-MM-DD, from the SSR wrapper
};

type Form = {
  date: string;
  covers: string;
  guests: string;
  tickets: string;
  food: string;
  wine: string;
  bar: string;
  softs: string;
  tips: string;
  service: string;
  cash: string;
  card: string;
  notes: string;
};

function yesterday(today: string): string {
  const d = new Date(today + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
function eur(n: number): string {
  if (!Number.isFinite(n)) return "€0";
  return "€" + n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function num(s: string): number {
  const n = Number(String(s).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

const EMPTY: Omit<Form, "date"> = {
  covers: "", guests: "", tickets: "",
  food: "", wine: "", bar: "", softs: "",
  tips: "", service: "",
  cash: "", card: "", notes: "",
};

export default function ManualEodClient({ entityId, houseSlug, today }: Props) {
  const [form, setForm] = useState<Form>({ date: yesterday(today), ...EMPTY });
  const [missing, setMissing] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  // Load the "missing last 30 days" list — refreshed after every successful save.
  const loadStatus = async () => {
    try {
      const r = await fetch(`/api/eod/manual/status?entity=${encodeURIComponent(entityId)}&days=30`, { cache: "no-store" });
      const d = await r.json();
      if (d?.ok) setMissing(Array.isArray(d.missing) ? d.missing : []);
    } catch { /* non-fatal */ }
  };
  useEffect(() => { loadStatus(); }, [entityId]);

  const totalGross = useMemo(() => {
    return num(form.food) + num(form.wine) + num(form.bar) + num(form.softs) + num(form.tips) + num(form.service);
  }, [form.food, form.wine, form.bar, form.softs, form.tips, form.service]);

  const cashCardTotal = useMemo(() => num(form.cash) + num(form.card), [form.cash, form.card]);
  const paymentDelta = cashCardTotal - totalGross;

  const submit = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/eod/manual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          entity_id: entityId,
          date: form.date,
          covers: form.covers ? num(form.covers) : null,
          guests: form.guests ? num(form.guests) : null,
          tickets: form.tickets ? num(form.tickets) : null,
          food_gross_eur: num(form.food),
          wine_gross_eur: num(form.wine),
          bar_gross_eur: num(form.bar),
          softdrinks_gross_eur: num(form.softs),
          tips_eur: num(form.tips),
          service_charge_eur: num(form.service),
          cash_declared_eur: num(form.cash),
          card_declared_eur: num(form.card),
          notes: form.notes || null,
        }),
      });
      const d = await r.json();
      if (!d.ok) { setMsg({ kind: "err", text: d.error || "Save failed" }); }
      else {
        setMsg({ kind: "ok", text: `Saved · ${form.date} · ${eur(totalGross)}` });
        setForm({ date: yesterday(today), ...EMPTY });
        loadStatus();
      }
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message || "Network error" });
    }
    setBusy(false);
  };

  return (
    <>
      {/* Missing-days chip strip */}
      {missing.length > 0 ? (
        <section className="mt-6 border border-line px-3 py-3">
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">
            Missing · last 30 days · {missing.length}
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {missing.slice(0, 20).map((d) => (
              <li key={d}>
                <button
                  type="button"
                  onClick={() => set("date", d)}
                  className={"border px-2 py-1 font-mono text-[11px] hover:border-ink " +
                    (form.date === d ? "border-ink text-ink" : "border-line text-clay")}
                  title={`Set date to ${d}`}
                >
                  {d}
                </button>
              </li>
            ))}
            {missing.length > 20 ? (
              <li className="font-mono text-[10px] text-clay">+ {missing.length - 20} more</li>
            ) : null}
          </ul>
          <p className="mt-2 font-serif italic text-[12px] text-ink-soft">
            Manager+ can back-fill up to 30 days ago — pick a chip and enter the numbers.
          </p>
        </section>
      ) : null}

      {/* Form */}
      <section className="mt-8 border-t border-line pt-6">
        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Trading date</p>
            <input
              type="date"
              value={form.date}
              max={today}
              onChange={(e) => set("date", e.target.value)}
              className="mt-1 w-full border-b border-line bg-transparent py-2 font-serif text-[18px] text-ink outline-none"
            />
            <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-clay">
              default: yesterday · Madrid tz
            </p>
          </div>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wide text-clay">People</p>
            <div className="mt-1 grid grid-cols-2 gap-3">
              <Numeric label="Covers"  value={form.covers}  onChange={(v) => set("covers", v)}  integer />
              <Numeric label="Guests"  value={form.guests}  onChange={(v) => set("guests", v)}  integer />
              <Numeric label="Tickets" value={form.tickets} onChange={(v) => set("tickets", v)} integer />
            </div>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-clay">
              covers = physical seat count · tickets = item count
            </p>
          </div>
        </div>

        <div className="mt-8">
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Revenue split · gross (VAT-in)</p>
          <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Numeric label="Food"       value={form.food}   onChange={(v) => set("food", v)} money big />
            <Numeric label="Wine"       value={form.wine}   onChange={(v) => set("wine", v)} money big />
            <Numeric label="Bar"        value={form.bar}    onChange={(v) => set("bar", v)}  money big />
            <Numeric label="Softdrinks" value={form.softs}  onChange={(v) => set("softs", v)} money big />
            <Numeric label="Tips"       value={form.tips}   onChange={(v) => set("tips", v)} money />
            <Numeric label="Service"    value={form.service} onChange={(v) => set("service", v)} money />
          </div>
        </div>

        <div className="mt-8">
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Payment channels · declared</p>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <Numeric label="Cash" value={form.cash} onChange={(v) => set("cash", v)} money big />
            <Numeric label="Card" value={form.card} onChange={(v) => set("card", v)} money big />
          </div>
        </div>

        <div className="mt-8">
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Notes · optional</p>
          <textarea
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
            rows={2}
            placeholder="e.g. till glitch at 22:10 — cash short €12"
            className="mt-1 w-full border-b border-line bg-transparent py-2 font-serif italic text-[14px] text-ink-soft outline-none"
          />
        </div>

        {/* Totals summary */}
        <section className="mt-8 border-t border-line pt-4">
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Totals</p>
          <div className="mt-2 grid grid-cols-3 gap-3">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Revenue gross</p>
              <p className="font-serif text-[22px] text-ink">{eur(totalGross)}</p>
            </div>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Payments declared</p>
              <p className="font-serif text-[22px] text-ink">{eur(cashCardTotal)}</p>
            </div>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Payment Δ</p>
              <p className={"font-serif text-[22px] " + (Math.abs(paymentDelta) < 0.005 ? "text-ink" : "text-tomato")}>
                {(paymentDelta >= 0 ? "+" : "") + eur(paymentDelta).replace("€", "")}€
              </p>
            </div>
          </div>
          {Math.abs(paymentDelta) > 0.005 ? (
            <p className="mt-2 font-serif italic text-[12px] text-tomato">
              Cash + Card ≠ revenue gross. Fine for tip-only cash days, worth a note otherwise.
            </p>
          ) : null}
        </section>

        <div className="mt-8 flex items-baseline justify-between gap-3 border-t border-line pt-4">
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">
            Writes to <span className="not-italic">eod_pos</span> · source=manual
          </p>
          <button
            type="button"
            onClick={submit}
            disabled={busy || totalGross <= 0}
            className="border border-ink bg-ink px-6 py-3 font-sans text-[15px] font-medium text-paper hover:opacity-90 disabled:opacity-40"
          >
            {busy ? "Saving…" : `Save close · ${eur(totalGross)}`}
          </button>
        </div>

        {msg ? (
          <p className={"mt-4 font-mono text-[12px] " + (msg.kind === "ok" ? "text-ink" : "text-tomato")}>
            {msg.kind === "ok" ? "✓ " : "⚠ "}{msg.text}
          </p>
        ) : null}
      </section>

      <p className="mt-10 font-mono text-[10px] uppercase tracking-wide text-clay">
        <Link href={`/h/${houseSlug}`} className="hover:text-ink">← back to the house</Link>
      </p>
    </>
  );
}

function Numeric({
  label, value, onChange, integer, money, big,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  integer?: boolean;
  money?: boolean;
  big?: boolean;
}) {
  return (
    <label className="block">
      <span className="font-mono text-[10px] uppercase tracking-wide text-clay">{label}</span>
      <div className="mt-1 flex items-baseline gap-1 border-b border-line pb-1">
        {money ? <span className="font-serif text-[15px] text-clay">€</span> : null}
        <input
          inputMode={integer ? "numeric" : "decimal"}
          pattern={integer ? "[0-9]*" : "[0-9]*[.,]?[0-9]*"}
          value={value}
          onChange={(e) => {
            const raw = e.target.value;
            if (integer) onChange(raw.replace(/[^0-9]/g, ""));
            else onChange(raw.replace(/[^0-9.,]/g, ""));
          }}
          placeholder="0"
          className={"w-full bg-transparent text-right font-serif text-ink outline-none " + (big ? "text-[22px]" : "text-[16px]")}
        />
      </div>
    </label>
  );
}
