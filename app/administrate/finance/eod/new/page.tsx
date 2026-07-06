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
  _draft?: boolean;
};

export default function NewEod() {
  const [entity, setEntity] = useState<EntityKey>("utopia");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [uploadErr, setUploadErr] = useState("");
  const [pos, setPos] = useState<PosSnapshot | null>(null);
  const [acctId, setAcctId] = useState<string | null>(null);
  const [devs, setDevs] = useState<Deviation[]>([]);
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
        const acctQ = await supabaseBrowser.from("eod_accounting")
          .select("id").eq("restaurant_id", rid).eq("report_date", date).maybeSingle();
        const acctIdVal = acctQ.data?.id || null;
        setAcctId(acctIdVal);
        const devQ = await supabaseBrowser.from("eod_deviations")
          .select("id,category,affected_line,amount_eur,description")
          .eq("eod_pos_id", posRow.id);
        setDevs((devQ.data || []).map((d: any) => ({
          id: d.id, category: d.category, affected_line: d.affected_line,
          amount_eur: Number(d.amount_eur), description: d.description || "",
        })));
      } else {
        setAcctId(null); setDevs([]);
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
        // Also create the accounting seed row so the right column has an id to write against
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

  // Derive accounting totals: POS totals + signed deviations by affected line.
  const totals = useMemo(() => {
    const start = {
      food: pos ? Number(pos.food_net_eur) : 0,
      wine: pos ? Number(pos.wine_net_eur) : 0,
      bar: pos ? Number(pos.bar_net_eur) : 0,
      softdrinks: pos ? Number(pos.softdrinks_net_eur) : 0,
      tips: pos ? Number(pos.tips_eur) : 0,
    };
    for (const d of devs) {
      if (d.affected_line === "food") start.food += d.amount_eur;
      if (d.affected_line === "wine") start.wine += d.amount_eur;
      if (d.affected_line === "bar") start.bar += d.amount_eur;
      if (d.affected_line === "softdrinks") start.softdrinks += d.amount_eur;
      if (d.affected_line === "tips") start.tips += d.amount_eur;
      // cash/card/service adjust totals only, not per-category revenue lines.
    }
    return start;
  }, [pos, devs]);

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
  const uncategorised = Math.abs(delta - sumDevs) > 0.01 ? +(delta - sumDevs).toFixed(2) : 0;

  const addDeviation = (cat: CategoryKey) => {
    const defaultLine: AffectedLine =
      cat === "cash_deficit" ? "cash" :
      cat === "rounding"     ? "cash" :
      "food";
    setDevs((d) => [...d, { category: cat, affected_line: defaultLine, amount_eur: 0, description: "", _draft: true }]);
  };

  const saveDeviation = async (i: number) => {
    if (!pos) return;
    const d = devs[i];
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
      }).select("id").single();
      if (ins.error) { setErr(ins.error.message); return; }
      setDevs((all) => all.map((x, idx) => idx === i ? { ...x, id: ins.data.id, _draft: false } : x));
    }
  };

  const deleteDeviation = async (i: number) => {
    const d = devs[i];
    if (d.id) await supabaseBrowser.from("eod_deviations").delete().eq("id", d.id);
    setDevs((all) => all.filter((_, idx) => idx !== i));
  };

  const submit = async () => {
    setBusy(true); setErr(""); setResult(null);
    try {
      const r = await fetch("/api/finance/post-eod", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          entity: ec, date, restaurant_id: rid,
          covers: pos?.covers || 0,
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
        {!pos ? (
          <>
            <input type="file" accept=".xlsx,.xls,.csv" className="hidden" id="fresto-xlsx" onChange={(e) => onPickFresto(e.target.files?.[0])} />
            <label htmlFor="fresto-xlsx" className="cursor-pointer border border-line px-4 py-2 font-mono text-[11px] uppercase tracking-wide text-ink hover:border-ink-soft">Upload Fresto export</label>
            <span className="font-mono text-[10px] uppercase tracking-wide text-clay">or use Chef FAB camera on mobile</span>
          </>
        ) : (
          <span className="font-mono text-[10px] uppercase tracking-wide" style={{ color: "var(--accent)" }}>POS snapshot loaded</span>
        )}
        {uploadErr ? <span className="font-mono text-[11px] text-tomato">⚠ {uploadErr}</span> : null}
      </div>

      {/* Three-column view */}
      <div className="mt-8 grid gap-8 md:grid-cols-3">

        {/* LEFT — POS EOD (locked) */}
        <section>
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">POS EOD · locked</p>
          <h2 className="mt-1 font-serif text-2xl text-ink">Fresto snapshot</h2>
          {!pos ? (
            <p className="mt-4 font-serif italic text-[14px] text-ink-soft">No POS snapshot for {date}. Upload the Fresto export or use the Chef FAB camera.</p>
          ) : (
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
          )}
        </section>

        {/* MIDDLE — Deviations */}
        <section>
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Deviations · categorised</p>
          <h2 className="mt-1 font-serif text-2xl text-ink">What changed</h2>
          {!pos ? (
            <p className="mt-4 font-serif italic text-[14px] text-ink-soft">Load a POS snapshot to log deviations.</p>
          ) : (
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
                    <div className="flex items-baseline justify-between">
                      <span className="font-serif text-[15px] text-ink capitalize">{d.category.replace("_"," ")}</span>
                      <button onClick={() => deleteDeviation(i)} className="font-mono text-[10px] uppercase tracking-wide text-clay hover:text-tomato">remove</button>
                    </div>
                    <div className="mt-2 flex flex-wrap items-baseline gap-3">
                      <label className="flex items-baseline gap-2">
                        <span className="font-mono text-[10px] uppercase tracking-wide text-clay">line</span>
                        <select value={d.affected_line} onChange={(e) => setDevs((all) => all.map((x, j) => j === i ? { ...x, affected_line: e.target.value as AffectedLine } : x))}
                          className="bg-transparent font-mono text-[12px] text-ink outline-none">
                          {AFFECTED_LINES.map((l) => <option key={l} value={l}>{l}</option>)}
                        </select>
                      </label>
                      <label className="flex items-baseline gap-2">
                        <span className="font-mono text-[10px] uppercase tracking-wide text-clay">€</span>
                        <input inputMode="decimal" value={String(d.amount_eur)}
                          onChange={(e) => setDevs((all) => all.map((x, j) => j === i ? { ...x, amount_eur: Number(String(e.target.value).replace(",", ".")) || 0 } : x))}
                          className="w-24 bg-transparent text-right font-mono text-[14px] text-ink outline-none border-b border-line" />
                      </label>
                      <input placeholder="note" value={d.description}
                        onChange={(e) => setDevs((all) => all.map((x, j) => j === i ? { ...x, description: e.target.value } : x))}
                        className="flex-1 min-w-[120px] bg-transparent font-serif italic text-[13px] text-ink-soft outline-none border-b border-line" />
                      <button onClick={() => saveDeviation(i)} className="border border-line px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-ink hover:border-ink-soft">
                        {d.id ? "update" : "save"}
                      </button>
                    </div>
                  </li>
                ))}
                {!devs.length ? <li className="mt-4 font-serif italic text-[13px] text-ink-soft">No deviations yet. If POS totals match reality exactly, book them as-is.</li> : null}
              </ul>
            </>
          )}
        </section>

        {/* RIGHT — Accounting EOD (editable · bookable) */}
        <section>
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Accounting EOD · editable</p>
          <h2 className="mt-1 font-serif text-2xl text-ink">Book to {ec}</h2>
          {!pos ? (
            <p className="mt-4 font-serif italic text-[14px] text-ink-soft">Load a POS snapshot to compute the accounting entry.</p>
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
      {pos ? (
        <section className="mt-10 border-t border-line pt-4">
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Delta summary</p>
          <p className="mt-2 font-serif text-[18px] text-ink">
            Delta: {eurSigned(delta)} · {devs.filter((d) => !d._draft && d.id).length} categorised deviation{devs.filter((d) => !d._draft && d.id).length === 1 ? "" : "s"}
            {uncategorised !== 0 ? <> · <span className="text-tomato">{eurSigned(uncategorised)} uncategorised</span></> : null}
          </p>
          {uncategorised !== 0 ? <p className="mt-1 font-serif italic text-[13px] text-tomato">The delta between POS and accounting is not fully explained by categorised deviations. Add more rows or adjust amounts.</p> : null}
        </section>
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
