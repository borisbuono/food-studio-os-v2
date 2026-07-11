"use client";
import { useState } from "react";

type EntityCode = "IFL" | "BM" | "BBH";

type Pattern = {
  id: string;
  entity_code: EntityCode;
  pattern_type: string;
  reference_regex: string;
  expected_amount_range: { min?: number; max?: number; sign?: string } | null;
  expected_frequency: string;
  match_type: string;
  label: string;
  learn_confidence: number;
  first_seen: string | null;
  last_seen: string | null;
  times_matched: number;
  disabled_at: string | null;
  bank_account: string | null;
  created_at: string;
};

const PATTERN_TYPES = ["salary", "tax", "loan", "utility", "intercompany", "subscription", "manual"] as const;
const MATCH_TYPES = ["invoice", "eod", "asiento", "intercompany", "salary", "tax", "self-transfer", "unknown"] as const;
const FREQUENCIES = ["weekly", "biweekly", "monthly", "quarterly", "yearly", "irregular"] as const;

const eur = (n: number | null | undefined) => (n == null ? "—" : (n < 0 ? "-€" : "€") + Math.abs(Number(n)).toFixed(0));

export default function PatternsClient({ initial, entityCode }: { initial: Pattern[]; entityCode: EntityCode }) {
  const [rows, setRows] = useState<Pattern[]>(initial);
  const [addOpen, setAddOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<string>("");

  // Add form state
  const [ptype, setPtype] = useState<string>("manual");
  const [regex, setRegex] = useState<string>("");
  const [label, setLabel] = useState<string>("");
  const [mtype, setMtype] = useState<string>("unknown");
  const [freq, setFreq] = useState<string>("monthly");
  const [amountMin, setAmountMin] = useState<string>("");
  const [amountMax, setAmountMax] = useState<string>("");
  const [account, setAccount] = useState<string>("");

  async function toggleDisabled(p: Pattern) {
    setPending(true);
    try {
      const r = await fetch("/api/finance/reconciliation/patterns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: p.disabled_at ? "enable" : "disable", id: p.id }),
      }).then((x) => x.json());
      if (!r.ok) throw new Error(r.error);
      setRows((L) => L.map((x) => x.id === p.id ? { ...x, disabled_at: p.disabled_at ? null : new Date().toISOString() } : x));
    } catch (e: any) { alert(e?.message || e); }
    finally { setPending(false); }
  }

  async function del(p: Pattern) {
    if (!confirm("Delete pattern '" + p.label + "'?")) return;
    setPending(true);
    try {
      const r = await fetch("/api/finance/reconciliation/patterns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "delete", id: p.id }),
      }).then((x) => x.json());
      if (!r.ok) throw new Error(r.error);
      setRows((L) => L.filter((x) => x.id !== p.id));
    } catch (e: any) { alert(e?.message || e); }
    finally { setPending(false); }
  }

  async function addPattern() {
    if (!regex.trim() || !label.trim()) { alert("Regex and label required"); return; }
    setPending(true);
    try {
      const range: any = {};
      if (amountMin.trim()) range.min = Number(amountMin);
      if (amountMax.trim()) range.max = Number(amountMax);
      const r = await fetch("/api/finance/reconciliation/patterns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "add",
          pattern: {
            entity_code: entityCode,
            pattern_type: ptype,
            reference_regex: regex.trim(),
            label: label.trim(),
            match_type: mtype,
            expected_frequency: freq,
            expected_amount_range: range,
            bank_account: account.trim() || null,
          },
        }),
      }).then((x) => x.json());
      if (!r.ok) throw new Error(r.error);
      setMsg("Pattern added. Refresh to see it in the table.");
      setAddOpen(false);
      setRegex(""); setLabel(""); setAmountMin(""); setAmountMax(""); setAccount("");
    } catch (e: any) { alert(e?.message || e); }
    finally { setPending(false); }
  }

  async function forceLearn() {
    setPending(true);
    setMsg("");
    try {
      const r = await fetch("/api/finance/reconciliation/patterns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "learn", entity_code: entityCode }),
      }).then((x) => x.json());
      if (!r.ok) throw new Error(r.error);
      setMsg("Learning pass complete · " + r.learned + " pattern(s) upserted. Refresh to see them.");
    } catch (e: any) { setMsg("Learn failed: " + (e?.message || e)); }
    finally { setPending(false); }
  }

  return (
    <div>
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <button
          onClick={() => setAddOpen((x) => !x)}
          className="rounded-full border border-ink px-3 py-1 font-mono text-[11px] uppercase tracking-wide text-ink hover:bg-paper-deep">
          {addOpen ? "cancel" : "add pattern"}
        </button>
        <button
          onClick={forceLearn}
          disabled={pending}
          className="rounded-full border border-line px-3 py-1 font-mono text-[11px] uppercase tracking-wide text-ink-soft hover:border-ink-soft disabled:opacity-40">
          {pending ? "learning…" : "force-learn from accepted"}
        </button>
      </div>
      {msg ? <p className="mt-2 font-mono text-[10px] uppercase tracking-wide text-ink-soft">{msg}</p> : null}

      {addOpen ? (
        <section className="mt-4 rounded-2xl border border-line bg-paper-deep p-4">
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Add pattern manually</p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="col-span-2 flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-wide text-ink-soft">Label</span>
              <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Payroll · Vanessa" className="rounded border border-line bg-paper px-2 py-1 font-mono text-[12px]" />
            </label>
            <label className="col-span-2 flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-wide text-ink-soft">Description regex (case-insensitive)</span>
              <input value={regex} onChange={(e) => setRegex(e.target.value)} placeholder="NOMINA.*VANESSA" className="rounded border border-line bg-paper px-2 py-1 font-mono text-[12px]" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-wide text-ink-soft">Pattern type</span>
              <select value={ptype} onChange={(e) => setPtype(e.target.value)} className="rounded border border-line bg-paper px-2 py-1 font-mono text-[12px]">
                {PATTERN_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-wide text-ink-soft">Match type</span>
              <select value={mtype} onChange={(e) => setMtype(e.target.value)} className="rounded border border-line bg-paper px-2 py-1 font-mono text-[12px]">
                {MATCH_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-wide text-ink-soft">Frequency</span>
              <select value={freq} onChange={(e) => setFreq(e.target.value)} className="rounded border border-line bg-paper px-2 py-1 font-mono text-[12px]">
                {FREQUENCIES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-wide text-ink-soft">Bank account (optional)</span>
              <input value={account} onChange={(e) => setAccount(e.target.value)} placeholder="CaixaBank 6484" className="rounded border border-line bg-paper px-2 py-1 font-mono text-[12px]" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-wide text-ink-soft">Expected amount (EUR, signed) — min</span>
              <input value={amountMin} onChange={(e) => setAmountMin(e.target.value)} placeholder="-1500" className="rounded border border-line bg-paper px-2 py-1 font-mono text-[12px]" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-wide text-ink-soft">... max</span>
              <input value={amountMax} onChange={(e) => setAmountMax(e.target.value)} placeholder="-1200" className="rounded border border-line bg-paper px-2 py-1 font-mono text-[12px]" />
            </label>
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={addPattern} disabled={pending} className="rounded-full border border-basil px-3 py-1 font-mono text-[11px] uppercase tracking-wide text-basil hover:bg-basil/10 disabled:opacity-40">Save pattern</button>
          </div>
        </section>
      ) : null}

      {rows.length === 0 ? (
        <p className="mt-8 font-serif italic text-[15px] text-ink-soft">
          No patterns yet. Accept a few proposed matches on the reconciliation page and the matcher will learn — or add one manually above.
        </p>
      ) : (
        <ul className="mt-6 divide-y divide-line border-t border-line">
          {rows.map((p) => (
            <li key={p.id} className="py-3">
              <div className="flex items-baseline justify-between gap-3">
                <div>
                  <p className={"font-serif text-[15px] " + (p.disabled_at ? "text-ink-soft italic" : "text-ink")}>{p.label}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-wide text-clay">
                    <span>{p.pattern_type}</span>
                    <span>· {p.expected_frequency}</span>
                    <span>· seen {p.times_matched}×</span>
                    {p.last_seen ? <span>· last {p.last_seen}</span> : null}
                    {p.bank_account ? <span>· {p.bank_account}</span> : null}
                    <span>· {eur(p.expected_amount_range?.min)}–{eur(p.expected_amount_range?.max)}</span>
                    {p.disabled_at ? <span className="rounded-full border border-tomato/40 bg-tomato/10 px-2 py-[1px] text-tomato">disabled</span> : null}
                  </p>
                  <p className="mt-1 font-mono text-[10px] text-ink-soft break-all">/{p.reference_regex}/i → {p.match_type}</p>
                </div>
                <div className="flex flex-col gap-1">
                  <button onClick={() => toggleDisabled(p)} disabled={pending} className="rounded-full border border-line px-2.5 py-[3px] font-mono text-[10px] uppercase tracking-wide text-ink-soft hover:border-ink-soft disabled:opacity-40">
                    {p.disabled_at ? "enable" : "disable"}
                  </button>
                  <button onClick={() => del(p)} disabled={pending} className="rounded-full border border-line px-2.5 py-[3px] font-mono text-[10px] uppercase tracking-wide text-ink-soft hover:border-tomato hover:text-tomato disabled:opacity-40">
                    delete
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
