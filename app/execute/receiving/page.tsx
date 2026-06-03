"use client";
import { useRef, useState, useEffect } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { getMyProfile } from "@/lib/profile";
import { ENTITY_TO_RESTAURANT, EntityKey } from "@/lib/entities";
import { noEmoji } from "@/lib/text";

type Target = { id: string; kind: "inventory" | "wine"; name: string; unit: string | null; cost: number | null };
type Line = { name: string; qty: number | null; unit: string | null; unit_price: number | null };
type Row = Line & { targetId: string };
type Move = { name: string; quantity: number; unit: string | null; reason: string; movement_at: string };

function downscale(file: File): Promise<{ data: string; media_type: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => { const max = 1600; let { width, height } = img; if (width > max || height > max) { const s = max / Math.max(width, height); width = Math.round(width * s); height = Math.round(height * s); } const c = document.createElement("canvas"); c.width = width; c.height = height; c.getContext("2d")!.drawImage(img, 0, 0, width, height); URL.revokeObjectURL(url); resolve({ data: c.toDataURL("image/jpeg", 0.85).split(",")[1], media_type: "image/jpeg" }); };
    img.onerror = reject; img.src = url;
  });
}
const eur = (n: number | null | undefined) => n == null ? "—" : "€" + Number(n).toFixed(2);
const kindOf = (name: string) => /sanit|degreas|cleaner|bleach|soap|roll|descal|towel|glove|film|label/i.test(name) ? "cleaning" : "food";
const matchTarget = (lineName: string, ts: Target[]) => { const n = (lineName || "").toLowerCase(); return ts.find((t) => { const tn = t.name.toLowerCase(); return tn && (n.includes(tn) || tn.includes(n.split(" ")[0])); })?.id || ""; };

export default function Receiving() {
  const [rid, setRid] = useState("");
  const [targets, setTargets] = useState<Target[]>([]);
  const [moves, setMoves] = useState<Move[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [supplier, setSupplier] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<string[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadMoves = async (rId: string, ts: Target[]) => {
    const invIds = ts.filter((t) => t.kind === "inventory").map((t) => t.id);
    if (!invIds.length) { setMoves([]); return; }
    const { data } = await supabaseBrowser.from("inventory_movements").select("inventory_item_id,quantity,unit,reason,movement_at").in("inventory_item_id", invIds).order("movement_at", { ascending: false }).limit(30);
    const nm = new Map(ts.map((t) => [t.id, t.name]));
    setMoves((data || []).map((m: any) => ({ name: noEmoji(nm.get(m.inventory_item_id) || ""), quantity: Number(m.quantity), unit: m.unit, reason: m.reason, movement_at: m.movement_at })));
  };

  useEffect(() => {
    (async () => {
      const p = await getMyProfile();
      const ent = (p && !p.isAdmin ? p.entity : ((localStorage.getItem("fs_entity") as EntityKey) || "utopia")) || "utopia";
      const r = p?.restaurantId || ENTITY_TO_RESTAURANT[ent as EntityKey] || ENTITY_TO_RESTAURANT.utopia!;
      setRid(r);
      const [{ data: inv }, { data: wines }] = await Promise.all([
        supabaseBrowser.from("inventory_items").select("id,name,unit,unit_cost").eq("restaurant_id", r),
        supabaseBrowser.from("menu_items").select("id,name,cost").eq("restaurant_id", r).eq("section", "wine").eq("is_active", true),
      ]);
      const ts: Target[] = [
        ...(inv || []).map((i: any) => ({ id: i.id, kind: "inventory" as const, name: i.name, unit: i.unit, cost: i.unit_cost })),
        ...(wines || []).map((w: any) => ({ id: w.id, kind: "wine" as const, name: w.name, unit: "bottle", cost: w.cost })),
      ];
      setTargets(ts); await loadMoves(r, ts);
    })();
  }, []);

  const onPick = async (file?: File | null) => {
    if (!file) return; setErr(""); setRows([]); setDone(null); setBusy(true);
    try {
      const { data, media_type } = await downscale(file);
      const res = await fetch("/api/invoice-scan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image: data, media_type }) });
      const d = await res.json();
      if (!d.ok) { setErr(d.error || "Couldn't read it."); setBusy(false); return; }
      setSupplier(d.invoice.supplier || "");
      setRows((d.invoice.lines || []).map((l: Line) => ({ ...l, targetId: matchTarget(l.name || "", targets) })));
    } catch (e: any) { setErr("Scan failed: " + (e?.message || "")); }
    setBusy(false);
  };

  const tById = (id: string) => targets.find((t) => t.id === id);
  const applicable = rows.filter((r) => r.targetId).length;
  const apply = async () => {
    setBusy(true); const msgs: string[] = [];
    for (const row of rows) {
      const t = tById(row.targetId); if (!t) continue;
      const price = row.unit_price != null ? Number(row.unit_price) : null;
      try {
        if (price != null) {
          if (t.kind === "inventory") await supabaseBrowser.from("inventory_items").update({ unit_cost: price, last_cost_update: new Date().toISOString() }).eq("id", t.id);
          else await supabaseBrowser.from("menu_items").update({ cost: price }).eq("id", t.id);
          await supabaseBrowser.from("price_history").insert({ restaurant_id: rid, item_kind: t.kind === "wine" ? "wine" : kindOf(t.name), item_id: t.id, name: t.name, unit: row.unit || t.unit, unit_price: price, supplier: supplier || null, source: "invoice" });
        }
        if (t.kind === "inventory" && row.qty && Number(row.qty) !== 0) {
          await supabaseBrowser.from("inventory_movements").insert({ inventory_item_id: t.id, quantity: Number(row.qty), unit: row.unit || t.unit, reason: "delivery_received", movement_at: new Date().toISOString() });
        }
        const old = t.cost;
        msgs.push(`✓ ${noEmoji(t.name)}${price != null ? ` · cost ${eur(price)}${old != null && old !== price ? ` (was ${eur(old)})` : ""}` : ""}${t.kind === "inventory" && row.qty ? ` · +${row.qty} ${row.unit || t.unit || ""} in` : ""}`);
      } catch (e: any) { msgs.push("⚠ " + noEmoji(t.name) + ": " + (e?.message || "")); }
    }
    await loadMoves(rid, targets);
    setDone(msgs); setBusy(false);
  };

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/" className="font-sans text-sm text-ink-soft">← home</Link>
      <p className="mt-6 font-sans text-xs font-medium text-basil">Receiving · delivery in</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">Log a delivery</h1>
      <p className="mt-2 font-sans text-[14px] leading-relaxed text-ink-soft">Photograph the delivery note. Chef reads the lines, matches them to your stock and wines — you confirm, and it updates costs, logs the price to the trend, and books the stock in.</p>

      <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onPick(e.target.files?.[0])} />
      <button onClick={() => fileRef.current?.click()} disabled={busy} className="mt-6 w-full rounded-xl px-6 py-4 font-sans text-[15px] font-medium text-[#FCEFE7] disabled:opacity-60" style={{ background: "var(--accent)" }}>{busy && !rows.length ? "Reading the delivery note…" : "Photograph a delivery note"}</button>
      {err ? <p className="mt-3 font-mono text-[11px] text-ember">{err}</p> : null}
      {supplier ? <p className="mt-3 font-mono text-[11px] uppercase tracking-wide text-clay">From {supplier}</p> : null}

      {rows.length && !done ? (
        <div className="mt-5 space-y-2">
          {rows.map((row, idx) => {
            const t = tById(row.targetId);
            return (
              <div key={idx} className="rounded-xl border border-black/10 bg-card p-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-sans text-[15px] text-ink">{row.name}</span>
                  <span className="shrink-0 font-mono text-[12px]" style={{ color: "var(--accent)" }}>{row.qty ?? "?"} {row.unit || ""} · {eur(row.unit_price)}</span>
                </div>
                <select value={row.targetId} onChange={(e) => setRows((rs) => rs.map((r, i) => i === idx ? { ...r, targetId: e.target.value } : r))} className="mt-2 w-full rounded-lg border border-black/15 bg-paper px-2 py-1.5 font-sans text-[13px] text-ink">
                  <option value="">— don’t apply —</option>
                  <optgroup label="Stock">{targets.filter((t) => t.kind === "inventory").map((t) => <option key={t.id} value={t.id}>{noEmoji(t.name)}</option>)}</optgroup>
                  <optgroup label="Wine">{targets.filter((t) => t.kind === "wine").map((t) => <option key={t.id} value={t.id}>{noEmoji(t.name)}</option>)}</optgroup>
                </select>
                {t ? <p className="mt-1 font-mono text-[10px] text-clay">cost {eur(t.cost)} → {eur(row.unit_price)}{t.kind === "inventory" && row.qty ? ` · books +${row.qty} in` : ""}</p> : null}
              </div>
            );
          })}
          <button onClick={apply} disabled={busy || !applicable} className="mt-3 w-full rounded-xl px-6 py-3 font-sans text-[14px] font-medium text-[#FCEFE7] disabled:opacity-50" style={{ background: "var(--accent)" }}>{busy ? "Booking in…" : `Receive ${applicable} line${applicable === 1 ? "" : "s"}`}</button>
        </div>
      ) : null}

      {done ? (
        <div className="mt-5 rounded-2xl border border-black/10 bg-card p-5">
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Received</p>
          <ul className="mt-2 space-y-1">{done.length ? done.map((m, i) => <li key={i} className="font-sans text-[14px] text-ink-soft">{m}</li>) : <li className="font-sans text-[14px] text-clay">Nothing matched — pick targets and try again.</li>}</ul>
          <button onClick={() => { setRows([]); setDone(null); setSupplier(""); }} className="mt-4 rounded-xl px-4 py-2 font-sans text-[13px] font-medium text-[#FCEFE7]" style={{ background: "var(--accent)" }}>Log another</button>
        </div>
      ) : null}

      <p className="mt-10 font-mono text-[11px] uppercase tracking-[0.18em] text-clay">Recent movements</p>
      <ul className="mt-2 divide-y divide-black/10 border-t border-black/10">
        {moves.map((m, i) => (
          <li key={i} className="flex items-baseline justify-between gap-4 py-2.5">
            <span className="font-sans text-[14px] text-ink">{m.name}</span>
            <span className="font-mono text-[11px] text-clay">{m.quantity > 0 ? "+" : ""}{m.quantity} {m.unit || ""} · {m.reason.replace("_", " ")}</span>
          </li>
        ))}
        {!moves.length ? <li className="py-2.5 font-sans text-[14px] text-clay">No movements yet — log a delivery above.</li> : null}
      </ul>
    </main>
  );
}
