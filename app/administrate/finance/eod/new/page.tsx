"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { ENTITY_TO_RESTAURANT, EntityKey } from "@/lib/entities";

const ENTITY_CODE: Record<string, "IFL" | "BM" | "BBH"> = { utopia: "IFL", taller: "IFL", bistro_mondo: "BM", holdings: "BBH" };
const eur = (n: number) => "€" + n.toFixed(2);

export default function NewEod() {
  const [entity, setEntity] = useState<EntityKey>("utopia");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [covers, setCovers] = useState("");
  const [food, setFood] = useState("");
  const [wine, setWine] = useState("");
  const [bar, setBar] = useState("");
  const [softdrinks, setSoft] = useState("");
  const [tips, setTips] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploadErr, setUploadErr] = useState("");

  const onPickFresto = async (file?: File | null) => {
    if (!file) return; setUploadErr(""); setBusy(true);
    try {
      const fd = new FormData(); fd.append("file", file);
      const r = await fetch("/api/pos/import", { method: "POST", body: fd });
      const d = await r.json();
      if (!d.ok) { setUploadErr(d.error || "Upload failed"); setBusy(false); return; }
      const row = (d.rows as any[]).find((x) => x.date === date) || (d.rows as any[])[d.rows.length - 1];
      if (!row) { setUploadErr("No row for " + date); setBusy(false); return; }
      if (row.date) setDate(row.date);
      if (row.covers) setCovers(String(row.covers));
      if (row.food) setFood(String(row.food));
      if (row.wine) setWine(String(row.wine));
      if (row.bar) setBar(String(row.bar));
      if (row.softdrinks) setSoft(String(row.softdrinks));
      if (row.tips) setTips(String(row.tips));
    } catch (e: any) { setUploadErr(e?.message || "Upload failed"); }
    setBusy(false);
  };
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    const e = (typeof window !== "undefined" ? localStorage.getItem("fs_entity") : null) as EntityKey | null;
    if (e) setEntity(e);
  }, []);

  const ec = ENTITY_CODE[entity] || "IFL";
  const t = (s: string) => Math.max(0, Number(s || 0));
  const totals = { food: t(food), wine: t(wine), bar: t(bar), softdrinks: t(softdrinks), tips: t(tips) };
  const totalNet = totals.food + totals.wine + totals.bar + totals.softdrinks + totals.tips;

  // Mirror eodLinesForEntity from the server adapter so the preview is exact
  const preview = useMemo(() => {
    const lines: { group: string; net: number; vat_rate: 0 | 10 | 21; account_code: string }[] = [];
    const ACC: Record<"IFL" | "BM" | "BBH", Record<string, string>> = {
      IFL: { food: "70500001", wine: "70500002", bar: "70500003", softdrinks: "70500004", tips: "70500006" },
      BM:  { food: "70000001", wine: "70000002", bar: "70000003", softdrinks: "70000004", tips: "70000006" },
      BBH: { food: "70000099", wine: "70000099", bar: "70000099", softdrinks: "70000099", tips: "70000099" },
    };
    const vat = (g: string): 0 | 10 | 21 => {
      if (ec === "IFL") return 10;
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

  const submit = async () => {
    setBusy(true); setErr(""); setResult(null);
    try {
      const rid = ENTITY_TO_RESTAURANT[entity] || ENTITY_TO_RESTAURANT.utopia!;
      const r = await fetch("/api/holded/post-eod", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entity: ec, date, restaurant_id: rid, covers: t(covers), description: `EOD ${date}`, ...totals }),
      });
      const d = await r.json();
      if (!d.ok) { setErr(d.error || "Post failed"); }
      else { setResult(d); }
    } catch (e: any) { setErr(e?.message || "Network error"); }
    setBusy(false);
  };

  const Inp = ({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) => (
    <label className="flex items-baseline gap-3 border-t border-line py-2.5">
      <span className="w-24 font-mono text-[11px] uppercase tracking-wide text-clay">{label}</span>
      <span className="font-mono text-clay">€</span>
      <input inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} placeholder="0.00" className="flex-1 bg-transparent text-right font-mono text-[16px] text-ink outline-none" />
    </label>
  );

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/administrate/finance/eod" className="font-sans text-sm text-ink-soft">← EOD list</Link>
      <p className="mt-6 font-mono text-[10px] uppercase tracking-wide text-clay">End of day · post to Holded</p>
      <h1 className="mt-2 font-serif text-4xl text-ink leading-tight">Close the day.</h1>
      <p className="mt-2 font-serif italic text-[14px] text-ink-soft">Enter the night's totals from Fresto. The OS renders the 4-line VAT split and you tap to post the sales receipt into Holded.</p>

      <div className="mt-5 border-t border-line pt-4">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Quick fill</p>
        <input type="file" accept=".xlsx,.xls,.csv" className="hidden" id="fresto-xlsx" onChange={(e) => onPickFresto(e.target.files?.[0])} />
        <label htmlFor="fresto-xlsx" className="mt-2 inline-block cursor-pointer rounded-xl border border-line bg-paper px-4 py-2.5 font-mono text-[11px] uppercase tracking-wide text-ink hover:border-ink-soft">Pull from Fresto export →</label>
        {uploadErr ? <p className="mt-2 font-mono text-[11px] text-tomato">⚠ {uploadErr}</p> : null}
      </div>

      <div className="mt-8 border-t border-line pt-4">
        <div className="flex items-baseline gap-3">
          <span className="w-24 font-mono text-[11px] uppercase tracking-wide text-clay">Entity</span>
          <span className="font-mono text-[14px] text-ink">{ec}</span>
          <span className="font-mono text-[10px] text-clay">· {entity}</span>
        </div>
        <div className="mt-2 flex items-baseline gap-3 border-t border-line py-2.5">
          <span className="w-24 font-mono text-[11px] uppercase tracking-wide text-clay">Date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="flex-1 bg-transparent font-mono text-[14px] text-ink outline-none" />
        </div>
        <div className="flex items-baseline gap-3 border-t border-line py-2.5">
          <span className="w-24 font-mono text-[11px] uppercase tracking-wide text-clay">Covers</span>
          <input inputMode="numeric" value={covers} onChange={(e) => setCovers(e.target.value)} placeholder="0" className="flex-1 bg-transparent font-mono text-[16px] text-ink outline-none" />
        </div>
        <Inp label="Food" value={food} onChange={setFood} />
        <Inp label="Wine" value={wine} onChange={setWine} />
        <Inp label="Bar" value={bar} onChange={setBar} />
        <Inp label="Soft" value={softdrinks} onChange={setSoft} />
        <Inp label="Tips" value={tips} onChange={setTips} />
      </div>

      {totalNet > 0 ? (
        <section className="mt-8 border-t border-line pt-5">
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Preview · what will post to Holded</p>
          <ul className="mt-3 divide-y divide-line border-t border-line">
            {preview.lines.map((l) => (
              <li key={l.group} className="flex items-baseline justify-between gap-3 py-2.5">
                <div>
                  <span className="font-serif text-[15px] text-ink capitalize">{l.group}</span>
                  <span className="ml-2 font-mono text-[10px] text-clay">{l.account_code} · IVA {l.vat_rate}%</span>
                </div>
                <span className="font-mono text-[13px] text-ink-soft">{eur(l.net)} <span className="text-clay">+ {eur((l.net * l.vat_rate) / 100)}</span></span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-baseline justify-between border-t border-line pt-3">
            <span className="font-mono text-[10px] uppercase tracking-wide text-clay">Total · net + VAT = gross</span>
            <span className="font-mono text-[14px] text-ink">{eur(totalNet)} + {eur(preview.totalVat)} = <strong>{eur(preview.gross)}</strong></span>
          </div>

          <button onClick={submit} disabled={busy} className="mt-6 w-full rounded-xl px-6 py-4 font-sans text-[15px] font-medium text-[#F7F7F4] disabled:opacity-60" style={{ background: "var(--accent)" }}>
            {busy ? "Posting…" : `Post to Holded — ${ec}`}
          </button>
          <p className="mt-2 font-mono text-[10px] uppercase tracking-wide text-clay">
            Dry-run mode is on by default. Real POST requires FS_HOLDED_DRY_RUN=false on the server.
          </p>
        </section>
      ) : null}

      {err ? <p className="mt-6 font-mono text-[12px] text-tomato">⚠ {err}</p> : null}
      {result ? (
        <section className="mt-6 border-t border-line pt-5">
          <p className="font-mono text-[10px] uppercase tracking-wide" style={{ color: "var(--accent)" }}>{result.dryRun ? "Dry-run · would have posted" : "✓ Posted to Holded"}</p>
          <p className="mt-2 font-serif text-[15px] text-ink">EOD saved · gross {eur(result.totals.gross)}</p>
          <p className="mt-1 font-mono text-[11px] text-clay">Holded ref: {result.holded_external_id || "—"}</p>
          {result.dryRun ? <p className="mt-2 font-serif italic text-[13px] text-ink-soft">No real POST happened — the payload is logged server-side. Flip FS_HOLDED_DRY_RUN to false to enable live posting.</p> : null}
        </section>
      ) : null}
    </main>
  );
}
