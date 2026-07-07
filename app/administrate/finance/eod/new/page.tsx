"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { ENTITY_TO_RESTAURANT, EntityKey } from "@/lib/entities";

const ENTITY_CODE: Record<string, "IFL" | "BM" | "BBH"> = { utopia: "IFL", taller: "IFL", bistro_mondo: "BM", holdings: "BBH" };
const eur = (n: number) => "€" + (Number.isFinite(n) ? n : 0).toFixed(2);
const eurSigned = (n: number) => (n < 0 ? "−€" : n > 0 ? "+€" : "€") + Math.abs(n).toFixed(2);

// Categorised deviation categories & UI labels — LOCKED per memory/pos_vs_accounting_separation.md
const CATEGORIES = [
  { key: "comp",         label: "Comp"        },
  { key: "discount",     label: "Discount"    },
  { key: "credit_tab",   label: "Credit tab"  },
  { key: "staff_meal",   label: "Staff meal"  },
  { key: "waste",        label: "Waste"       },
  { key: "pos_error",    label: "POS error"   },
  { key: "cash_deficit", label: "Cash deficit"},
  { key: "rounding",     label: "Rounding"    },
  { key: "other",        label: "Other"       },
] as const;
type CategoryKey = typeof CATEGORIES[number]["key"];

const AFFECTED_LINES = ["food","wine","bar","softdrinks","tips","service","cash","card"] as const;
type AffectedLine = typeof AFFECTED_LINES[number];

type PosSnapshot = {
  id: string; restaurant_id: string; date: string;
  source: string; source_ref: string | null;
  covers: number;
  food_net_eur: number; wine_net_eur: number; bar_net_eur: number; softdrinks_net_eur: number;
  tips_eur: number; service_charge_eur: number;
  cash_declared_eur: number; card_declared_eur: number;
  total_gross_eur: number;
  imported_at: string; imported_by: string | null;
};
type Deviation = {
  id?: string;
  category: CategoryKey;
  affected_line: AffectedLine;
  amount_eur: number;
  description: string;
  is_system?: boolean;
  is_system_override_reason?: string | null;
  _draft?: boolean;
  // Track the amount the system originally set for the system row — used to detect
  // an override so we can prompt for a reason before saving.
  _system_default_amount?: number;
};

// Reasons a user might legitimately edit a system deviation amount on a given day.
// LOCKED 2026-07-07 per per-restaurant cash rule migration.
const SYSTEM_OVERRIDE_REASONS: { key: string; label: string; blurb: string }[] = [
  { key: "legit_cash_exchange", label: "Legit cash exchange", blurb: "Real cash trade with a guest / staff." },
  { key: "no_card_terminal",   label: "No card terminal",   blurb: "Terminal down — cash was the only channel." },
  { key: "till_discrepancy",   label: "Till discrepancy",   blurb: "Counted cash differs from Fresto's line." },
  { key: "corrected_pos_mistake", label: "Corrected POS mistake", blurb: "Ring-up error already reconciled elsewhere." },
  { key: "other",              label: "Other",              blurb: "Free-text note in the description below." },
];

// Manual-EOD editable totals (when no POS snapshot exists — Boris punches numbers in).
type ManualTotals = {
  covers: number;
  food: number; wine: number; bar: number; softdrinks: number; tips: number;
  cash_declared: number;
};
const MANUAL_ZERO: ManualTotals = { covers: 0, food: 0, wine: 0, bar: 0, softdrinks: 0, tips: 0, cash_declared: 0 };

const SYSTEM_CASH_DESCRIPTION =
  "Fresto Cash line deducted from Food (house rule — cash line = EOD mistakes, not revenue)";

export default function NewEod() {
  const [entity, setEntity] = useState<EntityKey>("utopia");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [uploadErr, setUploadErr] = useState("");
  const [pos, setPos] = useState<PosSnapshot | null>(null);
  const [acctId, setAcctId] = useState<string | null>(null);
  const [devs, setDevs] = useState<Deviation[]>([]);
  const [manual, setManual] = useState<ManualTotals>(MANUAL_ZERO);
  const [manualMode, setManualMode] = useState(false);
  const [postDryRun, setPostDryRun] = useState(true);
  const [postApideck, setPostApideck] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    const e = (typeof window !== "undefined" ? localStorage.getItem("fs_entity") : null) as EntityKey | null;
    if (e) setEntity(e);
  }, []);

  const ec = ENTITY_CODE[entity] || "IFL";
  const rid = ENTITY_TO_RESTAURANT[entity] || ENTITY_TO_RESTAURANT.utopia!;

  // Load the POS snapshot + any existing accounting row + existing deviations for the day.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const posQ = await supabaseBrowser.from("eod_pos")
        .select("*")
        .eq("restaurant_id", rid).eq("date", date).eq("source", "fresto")
        .maybeSingle();
      if (cancelled) return;
      const posRow = posQ.data as PosSnapshot | null;
      setPos(posRow);
      if (posRow) {
        setManualMode(false);
        const acctQ = await supabaseBrowser.from("eod_accounting")
          .select("id").eq("restaurant_id", rid).eq("report_date", date).maybeSingle();
        const acctIdVal = acctQ.data?.id || null;
        setAcctId(acctIdVal);
        const devQ = await supabaseBrowser.from("eod_deviations")
          .select("id,category,affected_line,amount_eur,description,is_system,is_system_override_reason")
          .eq("eod_pos_id", posRow.id);
        setDevs((devQ.data || []).map((d: any) => ({
          id: d.id, category: d.category, affected_line: d.affected_line,
          amount_eur: Number(d.amount_eur), description: d.description || "",
          is_system: !!d.is_system,
          is_system_override_reason: d.is_system_override_reason ?? null,
          // For system rows we remember the original amount so an edit is
          // detectable — a rewritten row (override) needs a reason.
          _system_default_amount: d.is_system ? Number(d.amount_eur) : undefined,
        })));
      } else {
        setAcctId(null); setDevs([]); setManual(MANUAL_ZERO);
      }
    })();
    return () => { cancelled = true; };
  }, [rid, date]);

  const onPickFresto = async (file?: File | null) => {
    if (!file) return; setUploadErr(""); setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("entity", ec);
      fd.append("restaurant_id", rid);
      const r = await fetch("/api/finance/import-pos", { method: "POST", body: fd });
      const d = await r.json();
      if (!d.ok) { setUploadErr(d.error || "Upload failed"); setBusy(false); return; }
      const persisted = (d.persisted || []) as { date: string; eod_pos_id: string }[];
      const match = persisted.find((p) => p.date === date) || persisted[persisted.length - 1];
      if (match?.eod_pos_id) {
        // Also create the accounting seed row so the right column has an id to write against.
        // The seed route auto-inserts the SYSTEM cash-deduction deviation (house rule).
        await fetch("/api/finance/eod/create-accounting-from-pos", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ eod_pos_id: match.eod_pos_id }),
        });
        if (match.date) setDate(match.date);
      }
    } catch (e: any) { setUploadErr(e?.message || "Upload failed"); }
    setBusy(false);
  };

  // Manual mode base totals (no POS snapshot). Auto cash-deduction applied to Food.
  const manualBase = useMemo(() => ({
    food: Math.max(0, Number(manual.food || 0) - Number(manual.cash_declared || 0)),
    wine: Number(manual.wine || 0),
    bar: Number(manual.bar || 0),
    softdrinks: Number(manual.softdrinks || 0),
    tips: Number(manual.tips || 0),
  }), [manual]);

  // Derive accounting totals: base (POS or manual) + signed deviations by affected line.
  // In POS mode the system cash deviation is already in devs and reduces Food correctly.
  // In manual mode we apply the cash deduction directly on the base (no persisted POS to
  // hang a deviation off of), but still surface it in the delta summary as "1 system".
  const totals = useMemo(() => {
    const start = pos ? {
      food: Number(pos.food_net_eur),
      wine: Number(pos.wine_net_eur),
      bar: Number(pos.bar_net_eur),
      softdrinks: Number(pos.softdrinks_net_eur),
      tips: Number(pos.tips_eur),
    } : { ...manualBase };
    for (const d of devs) {
      if (d.affected_line === "food") start.food += d.amount_eur;
      if (d.affected_line === "wine") start.wine += d.amount_eur;
      if (d.affected_line === "bar") start.bar += d.amount_eur;
      if (d.affected_line === "softdrinks") start.softdrinks += d.amount_eur;
      if (d.affected_line === "tips") start.tips += d.amount_eur;
      // cash/card/service adjust totals only, not per-category revenue lines.
    }
    return start;
  }, [pos, devs, manualBase]);

  const totalNet = totals.food + totals.wine + totals.bar + totals.softdrinks + totals.tips;

  const preview = useMemo(() => {
    const lines: { group: string; net: number; vat_rate: 0 | 10 | 21; account_code: string }[] = [];
    const ACC: Record<"IFL" | "BM" | "BBH", Record<string, string>> = {
      IFL: { food: "70500001", wine: "70500002", bar: "70500003", softdrinks: "70500004", tips: "70500006" },
      BM:  { food: "70000001", wine: "70000002", bar: "70000003", softdrinks: "70000004", tips: "70000006" },
      BBH: { food: "70000099", wine: "70000099", bar: "70000099", softdrinks: "70000099", tips: "70000099" },
    };
    const vat = (g: string): 0 | 10 | 21 => {
      if (ec === "IFL") return g === "tips" ? 0 : 10;
      if (ec === "BM") return g === "wine" || g === "bar" ? 21 : g === "tips" ? 0 : 10;
      return 0;
    };
    const groups: Array<keyof typeof totals> = ["food", "wine", "bar", "softdrinks", "tips"];
    for (const g of groups) {
      const n = totals[g];
      if (!n) continue;
      lines.push({ group: g, net: n, vat_rate: vat(g), account_code: ACC[ec][g] || "70000099" });
    }
    const totalVat = lines.reduce((a, l) => a + (l.net * l.vat_rate) / 100, 0);
    return { lines, totalVat, gross: totalNet + totalVat };
  }, [totals, totalNet, ec]);

  const posGross = pos ? Number(pos.total_gross_eur) : 0;
  const sumDevs = devs.reduce((a, d) => a + d.amount_eur, 0);
  const delta = totalNet + preview.totalVat - posGross;
  const uncategorised = pos && Math.abs(delta - sumDevs) > 0.01 ? +(delta - sumDevs).toFixed(2) : 0;

  // Deviation counts — split system vs user for the delta summary.
  const savedDevs = devs.filter((d) => !d._draft && d.id);
  const savedSystem = savedDevs.filter((d) => d.is_system).length;
  const savedUser = savedDevs.length - savedSystem;
  // Manual mode: the cash deduction is applied directly, not persisted — count it as 1 system.
  const manualSystemCount = !pos && manualMode && Number(manual.cash_declared || 0) > 0 ? 1 : 0;
  const systemCount = savedSystem + manualSystemCount;
  const totalCategorisedCount = savedUser + systemCount;

  const addDeviation = (cat: CategoryKey) => {
    const defaultLine: AffectedLine =
      cat === "cash_deficit" ? "cash" :
      cat === "rounding"     ? "cash" :
      "food";
    setDevs((d) => [...d, { category: cat, affected_line: defaultLine, amount_eur: 0, description: "", _draft: true }]);
  };

  // System-deviation edit prompt state: when the user edits the amount of an
  // is_system=true row, we open a picker for the reason before persisting. The
  // picker updates is_system_override_reason on the row.
  const [reasonPrompt, setReasonPrompt] = useState<{ index: number } | null>(null);

  const saveDeviation = async (i: number) => {
    if (!pos) return;
    const d = devs[i];
    if (d.is_system) {
      // If the amount was edited off the system default, require a reason. Open
      // the picker and bail — the picker will re-invoke saveDeviation.
      const defaultAmt = Number(d._system_default_amount ?? d.amount_eur);
      const editedAmt = Number(d.amount_eur);
      const drifted = Math.abs(editedAmt - defaultAmt) > 0.005;
      if (drifted && !d.is_system_override_reason) {
        setReasonPrompt({ index: i });
        return;
      }
      // System rows: amount + description + override reason are editable; category /
      // affected_line / is_system are immutable at the DB level (trigger + policy).
      const r = await supabaseBrowser.from("eod_deviations").update({
        amount_eur: d.amount_eur,
        description: d.description || null,
        is_system_override_reason: d.is_system_override_reason || null,
      }).eq("id", d.id!);
      if (r.error) { setErr(r.error.message); return; }
      // After a successful override save the row's new "default" becomes the
      // edited amount — further edits without a fresh reason are allowed.
      setDevs((all) => all.map((x, j) => j === i ? { ...x, _system_default_amount: editedAmt } : x));
      return;
    }
    if (d.id) {
      const r = await supabaseBrowser.from("eod_deviations").update({
        category: d.category, affected_line: d.affected_line,
        amount_eur: d.amount_eur, description: d.description || null,
      }).eq("id", d.id);
      if (r.error) { setErr(r.error.message); return; }
    } else {
      const { data: userRes } = await supabaseBrowser.auth.getUser();
      const uid = userRes?.user?.id || null;
      const ins = await supabaseBrowser.from("eod_deviations").insert({
        eod_pos_id: pos.id,
        eod_accounting_id: acctId,
        category: d.category,
        affected_line: d.affected_line,
        amount_eur: d.amount_eur,
        description: d.description || null,
        created_by: uid,
        is_system: false,
      }).select("id").single();
      if (ins.error) { setErr(ins.error.message); return; }
      setDevs((all) => all.map((x, idx) => idx === i ? { ...x, id: ins.data.id, _draft: false } : x));
    }
  };

  const deleteDeviation = async (i: number) => {
    const d = devs[i];
    if (d.is_system) {
      setErr("System deviations cannot be deleted (house rule). Edit the amount if the cash was a legit exchange.");
      return;
    }
    if (d.id) {
      const r = await supabaseBrowser.from("eod_deviations").delete().eq("id", d.id);
      if (r.error) { setErr(r.error.message); return; }
    }
    setDevs((all) => all.filter((_, idx) => idx !== i));
  };

  const startManual = async () => {
    setManualMode(true);
    setDevs([]);
  };

  const submit = async () => {
    setBusy(true); setErr(""); setResult(null);
    try {
      const r = await fetch("/api/finance/post-eod", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          entity: ec, date, restaurant_id: rid,
          covers: pos?.covers || manual.covers || 0,
          description: `EOD ${date}`,
          eod_pos_id: pos?.id || null,
          food: totals.food, wine: totals.wine, bar: totals.bar,
          softdrinks: totals.softdrinks, tips: totals.tips,
          _via: postApideck ? "apideck" : "holded",
          _dryRun: postDryRun,
        }),
      });
      const d = await r.json();
      if (!d.ok) setErr(d.error || "Post failed"); else setResult(d);
    } catch (e: any) { setErr(e?.message || "Network error"); }
    setBusy(false);
  };

  const Kv = ({ label, value }: { label: string; value: string }) => (
    <div className="flex items-baseline justify-between border-t border-line py-2">
      <span className="font-mono text-[10px] uppercase tracking-wide text-clay">{label}</span>
      <span className="font-serif text-[15px] text-ink">{value}</span>
    </div>
  );

  const showRight = pos || manualMode;

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <Link href="/administrate/finance/eod" className="font-sans text-sm text-ink-soft">← EOD list</Link>
      <p className="mt-6 font-mono text-[10px] uppercase tracking-wide text-clay">End of day · {ec}</p>
      <h1 className="mt-2 font-serif text-4xl text-ink leading-tight">Close the day.</h1>
      <p className="mt-2 font-serif italic text-[14px] text-ink-soft">Two records. The POS snapshot is what Fresto rang up — locked. The accounting entry is what you book — editable. Every gap gets categorised.</p>

      {/* Date + upload row */}
      <div className="mt-6 flex flex-wrap items-baseline gap-4 border-t border-line pt-4">
        <label className="flex items-baseline gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wide text-clay">Date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="bg-transparent font-mono text-[14px] text-ink outline-none" />
        </label>
        {!pos && !manualMode ? (
          <>
            <input type="file" accept=".xlsx,.xls,.csv" className="hidden" id="fresto-xlsx" onChange={(e) => onPickFresto(e.target.files?.[0])} />
            <label htmlFor="fresto-xlsx" className="cursor-pointer border border-line px-4 py-2 font-mono text-[11px] uppercase tracking-wide text-ink hover:border-ink-soft">Upload Fresto export</label>
            <span className="font-mono text-[10px] uppercase tracking-wide text-clay">or use Chef FAB camera on mobile</span>
            <button onClick={startManual} className="border border-line px-4 py-2 font-mono text-[11px] uppercase tracking-wide text-ink hover:border-ink-soft">Enter manually</button>
          </>
        ) : pos ? (
          <span className="font-mono text-[10px] uppercase tracking-wide" style={{ color: "var(--accent)" }}>POS snapshot loaded</span>
        ) : (
          <span className="font-mono text-[10px] uppercase tracking-wide text-clay">Manual entry · no POS snapshot</span>
        )}
        {uploadErr ? <span className="font-mono text-[11px] text-tomato">⚠ {uploadErr}</span> : null}
      </div>

      {/* Three-column view */}
      <div className="mt-8 grid gap-8 md:grid-cols-3">

        {/* LEFT — POS EOD (locked) or Manual entry form */}
        <section>
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">
            {pos ? "POS EOD · locked" : manualMode ? "Manual entry · editable" : "POS EOD"}
          </p>
          <h2 className="mt-1 font-serif text-2xl text-ink">
            {pos ? "Fresto snapshot" : manualMode ? "What Boris books" : "Fresto snapshot"}
          </h2>
          {pos ? (
            <div className="mt-4">
              <Kv label="Covers"        value={String(pos.covers)} />
              <Kv label="Food net"      value={eur(pos.food_net_eur)} />
              <Kv label="Wine net"      value={eur(pos.wine_net_eur)} />
              <Kv label="Bar net"       value={eur(pos.bar_net_eur)} />
              <Kv label="Softdrinks"    value={eur(pos.softdrinks_net_eur)} />
              <Kv label="Tips"          value={eur(pos.tips_eur)} />
              <Kv label="Service"       value={eur(pos.service_charge_eur)} />
              <Kv label="Cash declared" value={eur(pos.cash_declared_eur)} />
              <Kv label="Card declared" value={eur(pos.card_declared_eur)} />
              <Kv label="Total gross"   value={eur(pos.total_gross_eur)} />
              <p className="mt-4 font-mono text-[10px] uppercase tracking-wide text-clay">
                source: {pos.source} · imported {new Date(pos.imported_at).toLocaleString("en-GB")}
              </p>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-clay">immutable · never edited</p>
            </div>
          ) : manualMode ? (
            <div className="mt-4">
              <ManualField label="Covers"     value={manual.covers}      onChange={(v) => setManual({ ...manual, covers: v })} integer />
              <ManualField label="Food"       value={manual.food}        onChange={(v) => setManual({ ...manual, food: v })} />
              <ManualField label="Wine"       value={manual.wine}        onChange={(v) => setManual({ ...manual, wine: v })} />
              <ManualField label="Bar"        value={manual.bar}         onChange={(v) => setManual({ ...manual, bar: v })} />
              <ManualField label="Softdrinks" value={manual.softdrinks}  onChange={(v) => setManual({ ...manual, softdrinks: v })} />
              <ManualField label="Tips"       value={manual.tips}        onChange={(v) => setManual({ ...manual, tips: v })} />
              <ManualField
                label="Cash declared"
                value={manual.cash_declared}
                onChange={(v) => setManual({ ...manual, cash_declared: v })}
                tooltip="House rule: Fresto Cash line = EOD mistakes, deducted from Food. Edit only if legit exchange."
              />
              <p className="mt-3 font-serif italic text-[12px] text-ink-soft">
                Cash declared is auto-deducted from Food (house rule).
              </p>
            </div>
          ) : (
            <p className="mt-4 font-serif italic text-[14px] text-ink-soft">No POS snapshot for {date}. Upload the Fresto export, use the Chef FAB camera, or enter manually.</p>
          )}
        </section>

        {/* MIDDLE — Deviations */}
        <section>
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Deviations · categorised</p>
          <h2 className="mt-1 font-serif text-2xl text-ink">What changed</h2>
          {!showRight ? (
            <p className="mt-4 font-serif italic text-[14px] text-ink-soft">Load a POS snapshot or start manual entry to log deviations.</p>
          ) : pos ? (
            <>
              <div className="mt-4 flex flex-wrap gap-2">
                {CATEGORIES.map((c) => (
                  <button key={c.key} onClick={() => addDeviation(c.key)}
                    className="border border-line px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-ink hover:border-ink-soft">
                    + {c.label}
                  </button>
                ))}
              </div>

              <ul className="mt-4">
                {devs.map((d, i) => (
                  <li key={d.id || `draft-${i}`} className="border-t border-line py-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="flex items-baseline gap-2">
                        <span className="font-serif text-[15px] text-ink capitalize">{d.category.replace("_"," ")}</span>
                        {d.is_system ? (
                          <span
                            title={SYSTEM_CASH_DESCRIPTION}
                            className="border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide"
                            style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
                          >
                            🔒 System
                          </span>
                        ) : null}
                        {d.is_system && d.is_system_override_reason ? (
                          <span
                            title={"Override reason: " + (SYSTEM_OVERRIDE_REASONS.find((r) => r.key === d.is_system_override_reason)?.label || d.is_system_override_reason)}
                            className="border border-clay px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-clay"
                          >
                            override · {SYSTEM_OVERRIDE_REASONS.find((r) => r.key === d.is_system_override_reason)?.label || d.is_system_override_reason}
                          </span>
                        ) : null}
                      </span>
                      <button
                        onClick={() => deleteDeviation(i)}
                        disabled={d.is_system}
                        className={"font-mono text-[10px] uppercase tracking-wide " + (d.is_system ? "text-clay opacity-40 cursor-not-allowed" : "text-clay hover:text-tomato")}
                        title={d.is_system ? "System deviations cannot be deleted — edit the amount if the cash was a legit exchange." : "remove"}
                      >
                        {d.is_system ? "locked" : "remove"}
                      </button>
                    </div>
                    <div className="mt-2 flex flex-wrap items-baseline gap-3">
                      <label className="flex items-baseline gap-2">
                        <span className="font-mono text-[10px] uppercase tracking-wide text-clay">line</span>
                        <select
                          value={d.affected_line}
                          disabled={d.is_system}
                          onChange={(e) => setDevs((all) => all.map((x, j) => j === i ? { ...x, affected_line: e.target.value as AffectedLine } : x))}
                          className={"bg-transparent font-mono text-[12px] text-ink outline-none " + (d.is_system ? "opacity-50" : "")}
                        >
                          {AFFECTED_LINES.map((l) => <option key={l} value={l}>{l}</option>)}
                        </select>
                      </label>
                      <label className="flex items-baseline gap-2">
                        <span className="font-mono text-[10px] uppercase tracking-wide text-clay">€</span>
                        <input inputMode="decimal" value={String(d.amount_eur)}
                          onChange={(e) => setDevs((all) => all.map((x, j) => j === i ? { ...x, amount_eur: Number(String(e.target.value).replace(",", ".")) || 0 } : x))}
                          className="w-24 bg-transparent text-right font-mono text-[14px] text-ink outline-none border-b border-line" />
                      </label>
                      <input
                        placeholder="note"
                        value={d.description}
                        onChange={(e) => setDevs((all) => all.map((x, j) => j === i ? { ...x, description: e.target.value } : x))}
                        className={"flex-1 min-w-[120px] bg-transparent font-serif italic text-[13px] outline-none border-b border-line " + (d.is_system ? "text-ink-soft" : "text-ink-soft")}
                      />
                      <button onClick={() => saveDeviation(i)} className="border border-line px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-ink hover:border-ink-soft">
                        {d.id ? "update" : "save"}
                      </button>
                    </div>
                  </li>
                ))}
                {!devs.length ? <li className="mt-4 font-serif italic text-[13px] text-ink-soft">No deviations yet. If POS totals match reality exactly, book them as-is.</li> : null}
              </ul>
            </>
          ) : (
            // Manual mode — no persisted POS snapshot, so no manual-added deviations
            // beyond the auto cash deduction (which is applied directly to Food above).
            <div className="mt-4 border-t border-line pt-3">
              {Number(manual.cash_declared || 0) > 0 ? (
                <div className="border border-line px-3 py-2">
                  <div className="flex items-baseline justify-between">
                    <span className="flex items-baseline gap-2">
                      <span className="font-serif text-[14px] text-ink">Cash deficit → Food</span>
                      <span
                        title={SYSTEM_CASH_DESCRIPTION}
                        className="border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide"
                        style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
                      >
                        🔒 System
                      </span>
                    </span>
                    <span className="font-mono text-[13px] text-ink">{eurSigned(-Number(manual.cash_declared || 0))}</span>
                  </div>
                  <p className="mt-1 font-serif italic text-[12px] text-ink-soft">{SYSTEM_CASH_DESCRIPTION}</p>
                </div>
              ) : (
                <p className="mt-2 font-serif italic text-[13px] text-ink-soft">Set a Cash declared amount to see the automatic Food deduction.</p>
              )}
            </div>
          )}
        </section>

        {/* RIGHT — Accounting EOD (editable · bookable) */}
        <section>
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Accounting EOD · editable</p>
          <h2 className="mt-1 font-serif text-2xl text-ink">Book to {ec}</h2>
          {!showRight ? (
            <p className="mt-4 font-serif italic text-[14px] text-ink-soft">Load a POS snapshot or start manual entry to compute the accounting entry.</p>
          ) : (
            <>
              <div className="mt-4">
                <Kv label="Food"       value={eur(totals.food)} />
                <Kv label="Wine"       value={eur(totals.wine)} />
                <Kv label="Bar"        value={eur(totals.bar)} />
                <Kv label="Softdrinks" value={eur(totals.softdrinks)} />
                <Kv label="Tips"       value={eur(totals.tips)} />
              </div>
              <div className="mt-4 border-t border-line pt-3">
                <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Holded 4-line VAT preview</p>
                <ul className="mt-2 divide-y divide-line border-t border-line">
                  {preview.lines.map((l) => (
                    <li key={l.group} className="flex items-baseline justify-between py-2">
                      <span className="font-serif text-[14px] text-ink capitalize">{l.group} <span className="font-mono text-[10px] text-clay">· {l.account_code} · IVA {l.vat_rate}%</span></span>
                      <span className="font-mono text-[12px] text-ink-soft">{eur(l.net)} <span className="text-clay">+ {eur((l.net * l.vat_rate) / 100)}</span></span>
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex items-baseline justify-between border-t border-line pt-2">
                  <span className="font-mono text-[10px] uppercase tracking-wide text-clay">Total gross</span>
                  <span className="font-mono text-[14px] text-ink">{eur(preview.gross)}</span>
                </div>
              </div>

              <div className="mt-4 border-t border-line pt-3 space-y-2">
                <label className="flex items-baseline gap-2">
                  <input type="checkbox" checked={postDryRun} onChange={(e) => setPostDryRun(e.target.checked)} />
                  <span className="font-mono text-[10px] uppercase tracking-wide text-clay">Post to Holded (dry-run)</span>
                </label>
                <label className="flex items-baseline gap-2">
                  <input type="checkbox" checked={postApideck} onChange={(e) => setPostApideck(e.target.checked)} />
                  <span className="font-mono text-[10px] uppercase tracking-wide text-clay">Route via Apideck</span>
                </label>
              </div>

              <button onClick={submit} disabled={busy || totalNet <= 0} className="mt-4 w-full px-6 py-4 font-sans text-[15px] font-medium text-[#F7F7F4] disabled:opacity-60" style={{ background: "var(--accent)" }}>
                {busy ? "Posting…" : `Post to accounting — ${ec}`}
              </button>
            </>
          )}
        </section>
      </div>

      {/* Delta summary */}
      {showRight ? (
        <section className="mt-10 border-t border-line pt-4">
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Delta summary</p>
          <p className="mt-2 font-serif text-[18px] text-ink">
            Delta: {pos ? eurSigned(delta) : eurSigned(-Number(manual.cash_declared || 0))} · {totalCategorisedCount} categorised deviation{totalCategorisedCount === 1 ? "" : "s"} ({systemCount} system)
            {uncategorised !== 0 ? <> · <span className="text-tomato">{eurSigned(uncategorised)} uncategorised</span></> : null}
          </p>
          {systemCount > 0 ? (
            <p className="mt-1 font-serif italic text-[13px] text-ink-soft">
              House rule: Fresto Cash line = EOD mistakes, deducted from Food. Edit only if legit exchange.
            </p>
          ) : null}
          {uncategorised !== 0 ? <p className="mt-1 font-serif italic text-[13px] text-tomato">The delta between POS and accounting is not fully explained by categorised deviations. Add more rows or adjust amounts.</p> : null}
        </section>
      ) : null}

      {/* System-override reason picker — opens when the user edits a system
          deviation's amount off its default. We block persisting until a reason
          is picked (or the user cancels back to the original amount). */}
      {reasonPrompt !== null ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/40 px-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl border border-line bg-paper p-6">
            <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Override reason · required</p>
            <h2 className="mt-1 font-serif text-2xl text-ink">Why the change?</h2>
            <p className="mt-2 font-serif italic text-[13px] text-ink-soft">
              You are overriding a system-generated deviation. Record why so the audit trail explains this day.
            </p>
            <ul className="mt-4 divide-y divide-line border-t border-line">
              {SYSTEM_OVERRIDE_REASONS.map((r) => (
                <li key={r.key}>
                  <button
                    onClick={() => {
                      const i = reasonPrompt.index;
                      setDevs((all) => all.map((x, j) => j === i ? { ...x, is_system_override_reason: r.key } : x));
                      setReasonPrompt(null);
                      // Re-invoke save on the next tick so state has updated.
                      setTimeout(() => saveDeviation(i), 0);
                    }}
                    className="w-full py-3 text-left hover:opacity-70"
                  >
                    <p className="font-serif text-[15px] text-ink">{r.label}</p>
                    <p className="mt-0.5 font-serif italic text-[12px] text-ink-soft">{r.blurb}</p>
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-5 flex items-baseline justify-between border-t border-line pt-3">
              <button
                onClick={() => {
                  // Cancel — revert the amount to the system default so the row is
                  // clean again.
                  const i = reasonPrompt.index;
                  setDevs((all) => all.map((x, j) => {
                    if (j !== i) return x;
                    const def = Number(x._system_default_amount ?? 0);
                    return { ...x, amount_eur: def };
                  }));
                  setReasonPrompt(null);
                }}
                className="font-mono text-[10px] uppercase tracking-wide text-clay hover:text-tomato"
              >
                Cancel — revert amount
              </button>
              <span className="font-mono text-[10px] uppercase tracking-wide text-clay">Pick one to continue</span>
            </div>
          </div>
        </div>
      ) : null}

      {err ? <p className="mt-6 font-mono text-[12px] text-tomato">⚠ {err}</p> : null}
      {result ? (
        <section className="mt-6 border-t border-line pt-5">
          <p className="font-mono text-[10px] uppercase tracking-wide" style={{ color: "var(--accent)" }}>{result.dryRun ? "Dry-run · would have posted" : "Posted to Holded"}</p>
          <p className="mt-2 font-serif text-[15px] text-ink">EOD saved · gross {eur(result?.totals?.gross || preview.gross)}</p>
          <p className="mt-1 font-mono text-[11px] text-clay">Adapter ref: {result.external_id || result.holded_external_id || "—"}</p>
        </section>
      ) : null}
    </main>
  );
}

// Small labelled numeric field used only in manual mode (POS mode uses <Kv/> read-only).
function ManualField({
  label, value, onChange, integer, tooltip,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  integer?: boolean;
  tooltip?: string;
}) {
  return (
    <div className="flex items-baseline justify-between border-t border-line py-2">
      <span className="flex items-baseline gap-2 font-mono text-[10px] uppercase tracking-wide text-clay">
        {label}
        {tooltip ? (
          <span title={tooltip} className="cursor-help border border-line px-1 text-[9px]" style={{ color: "var(--accent)", borderColor: "var(--accent)" }}>?</span>
        ) : null}
      </span>
      <input
        inputMode="decimal"
        value={String(value)}
        onChange={(e) => {
          const raw = String(e.target.value).replace(",", ".");
          const n = integer ? Math.max(0, Math.floor(Number(raw) || 0)) : Number(raw) || 0;
          onChange(n);
        }}
        className="w-24 bg-transparent text-right font-serif text-[15px] text-ink outline-none border-b border-line"
      />
    </div>
  );
}
