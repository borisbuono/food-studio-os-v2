"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { getMyProfile } from "@/lib/profile";
import { ENTITY_TO_RESTAURANT, EntityKey } from "@/lib/entities";
import { noEmoji } from "@/lib/text";

type Wine = { id: string; name: string; producer: string | null; cost: number | null; bottle_price: number | null };
type Line = { name: string; qty: number | null; unit: string | null; unit_price: number | null; total: number | null };
type Row = Line & { wineId: string | "" };

function downscale(file: File): Promise<{ data: string; media_type: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => { const max = 1600; let { width, height } = img; if (width > max || height > max) { const s = max / Math.max(width, height); width = Math.round(width * s); height = Math.round(height * s); } const c = document.createElement("canvas"); c.width = width; c.height = height; c.getContext("2d")!.drawImage(img, 0, 0, width, height); URL.revokeObjectURL(url); resolve({ data: c.toDataURL("image/jpeg", 0.85).split(",")[1], media_type: "image/jpeg" }); };
    img.onerror = reject; img.src = url;
  });
}
const eur = (n: number | null | undefined) => n == null ? "—" : "€" + Number(n).toFixed(2);
const matchWine = (lineName: string, wines: Wine[]) => {
  const n = lineName.toLowerCase();
  return wines.find((w) => { const wn = w.name.toLowerCase(); return wn && (n.includes(wn) || wn.includes(n.split(" ")[0])); })?.id || "";
};

export default function WinePrices() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [wines, setWines] = useState<Wine[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [supplier, setSupplier] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<string[] | null>(null);

  const onPick = async (file?: File | null) => {
    if (!file) return;
    setErr(""); setRows([]); setDone(null); setBusy(true);
    try {
      const p = await getMyProfile();
      const ent = (p && !p.isAdmin ? p.entity : ((localStorage.getItem("fs_entity") as EntityKey) || "utopia")) || "utopia";
      const rid = p?.restaurantId || ENTITY_TO_RESTAURANT[ent as EntityKey] || ENTITY_TO_RESTAURANT.utopia!;
      const { data: ws } = await supabaseBrowser.from("menu_items").select("id,name,producer,cost,bottle_price").eq("restaurant_id", rid).eq("section", "wine").eq("is_active", true);
      const wl = (ws || []) as Wine[]; setWines(wl);
      const { data, media_type } = await downscale(file);
      const r = await fetch("/api/invoice-scan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image: data, media_type }) });
      const d = await r.json();
      if (!d.ok) { setErr(d.error || "Couldn't read it."); setBusy(false); return; }
      setSupplier(d.invoice.supplier || "");
      setRows((d.invoice.lines || []).map((l: Line) => ({ ...l, wineId: matchWine(l.name || "", wl) })));
    } catch (e: any) { setErr("Scan failed: " + (e?.message || "")); }
    setBusy(false);
  };

  const wineById = (id: string) => wines.find((w) => w.id === id);
  const apply = async () => {
    setBusy(true); const msgs: string[] = [];
    for (const row of rows) {
      if (!row.wineId || row.unit_price == null) continue;
      const wine = wineById(row.wineId); if (!wine) continue;
      const old = wine.cost; const next = Number(row.unit_price);
      const { error } = await supabaseBrowser.from("menu_items").update({ cost: next }).eq("id", wine.id);
      if (error) { msgs.push("⚠ " + wine.name + ": " + error.message); continue; }
      const margin = wine.bottle_price != null ? Number(wine.bottle_price) - next : null;
      const move = old != null && old !== next ? ` (was ${eur(old)}${old ? `, ${next > old ? "+" : ""}${Math.round((next / old - 1) * 100)}%` : ""})` : "";
      msgs.push(`✓ ${noEmoji(wine.name)} cost → ${eur(next)}${move}${margin != null ? ` · bottle margin ${eur(margin)}` : ""}`);
    }
    setDone(msgs); setBusy(false);
  };

  const applicable = rows.filter((r) => r.wineId && r.unit_price != null).length;

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/develop/wine" className="font-sans text-sm text-ink-soft">← cellar</Link>
      <p className="mt-6 font-sans text-xs font-medium text-tomato">Cellar · prices from the delivery note</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">Update wine costs</h1>
      <p className="mt-2 font-sans text-[14px] leading-relaxed text-ink-soft">Photograph the delivery note or invoice. Chef reads the lines and matches them to your cellar; you confirm, and each wine’s cost updates so the margin re-costs itself. The recurring loop — every delivery keeps the prices honest.</p>

      <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onPick(e.target.files?.[0])} />
      <button onClick={() => fileRef.current?.click()} disabled={busy} className="mt-6 w-full rounded-xl px-6 py-4 font-sans text-[15px] font-medium text-[#FCEFE7] disabled:opacity-60" style={{ background: "var(--accent)" }}>{busy && !rows.length ? "Reading the invoice…" : "Photograph a delivery note"}</button>
      {err ? <p className="mt-3 font-mono text-[11px] text-ember">{err}</p> : null}
      {supplier ? <p className="mt-3 font-mono text-[11px] uppercase tracking-wide text-clay">From {supplier}</p> : null}

      {rows.length && !done ? (
        <div className="mt-5 space-y-2">
          {rows.map((row, idx) => {
            const wine = wineById(row.wineId);
            return (
              <div key={idx} className="rounded-xl border border-black/10 bg-card p-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-sans text-[15px] text-ink">{row.name}</span>
                  <span className="shrink-0 font-mono text-[12px]" style={{ color: "var(--accent)" }}>{eur(row.unit_price)}{row.unit ? " / " + row.unit : ""}</span>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <span className="font-mono text-[10px] uppercase tracking-wide text-clay">→</span>
                  <select value={row.wineId} onChange={(e) => setRows((rs) => rs.map((r, i) => i === idx ? { ...r, wineId: e.target.value } : r))} className="flex-1 rounded-lg border border-black/15 bg-paper px-2 py-1.5 font-sans text-[13px] text-ink">
                    <option value="">— don’t apply —</option>
                    {wines.map((w) => <option key={w.id} value={w.id}>{noEmoji(w.name)}{w.producer ? " · " + w.producer : ""}</option>)}
                  </select>
                </div>
                {wine ? <p className="mt-1 font-mono text-[10px] text-clay">cost {eur(wine.cost)} → {eur(row.unit_price)}{wine.bottle_price != null && row.unit_price != null ? ` · new bottle margin ${eur(Number(wine.bottle_price) - Number(row.unit_price))}` : ""}</p> : null}
              </div>
            );
          })}
          <button onClick={apply} disabled={busy || !applicable} className="mt-3 w-full rounded-xl px-6 py-3 font-sans text-[14px] font-medium text-[#FCEFE7] disabled:opacity-50" style={{ background: "var(--accent)" }}>{busy ? "Applying…" : `Apply ${applicable} cost update${applicable === 1 ? "" : "s"}`}</button>
        </div>
      ) : null}

      {done ? (
        <div className="mt-5 rounded-2xl border border-black/10 bg-card p-5">
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Costs updated</p>
          <ul className="mt-2 space-y-1">{done.length ? done.map((m, i) => <li key={i} className="font-sans text-[14px] text-ink-soft">{m}</li>) : <li className="font-sans text-[14px] text-clay">Nothing matched — try again or pick the wines manually.</li>}</ul>
          <Link href="/develop/wine" className="mt-4 inline-block rounded-xl px-4 py-2 font-sans text-[13px] font-medium text-[#FCEFE7]" style={{ background: "var(--accent)" }}>Back to cellar</Link>
        </div>
      ) : null}
    </main>
  );
}
