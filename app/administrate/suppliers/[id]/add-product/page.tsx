"use client";
import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabaseBrowser";

const UNITS = ["kg", "g", "l", "ml", "unit", "case", "box"];

export default function AddProduct() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({ name: "", unit: "kg", unit_price: "", pack_size: "" });

  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    const payload: any = { provider_id: params.id, name: f.name, unit: f.unit, is_active: true };
    if (f.unit_price) payload.unit_price = Number(f.unit_price);
    if (f.pack_size) payload.pack_size = f.pack_size;
    const { error } = await supabaseBrowser.from("provider_products").insert(payload);
    if (error) { setErr(error.message); setBusy(false); return; }
    router.push("/administrate/suppliers/" + params.id);
  }
  const inp = "mt-1 w-full rounded-xl border border-black/15 bg-card px-4 py-3 font-sans text-[14px] text-ink";
  const lbl = "font-mono text-[10px] uppercase tracking-wide text-clay";

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href={"/administrate/suppliers/" + params.id} className="font-sans text-sm text-ink-soft">← supplier</Link>
      <p className="mt-6 font-sans text-xs font-medium text-ink-soft">Add product</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">A new line for this supplier</h1>

      <form onSubmit={save} className="mt-8 space-y-4">
        <div><p className={lbl}>Product name</p><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Tomato — Raf, Almería" className={inp} required /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><p className={lbl}>Unit</p><select value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} className={inp}>{UNITS.map((u) => <option key={u}>{u}</option>)}</select></div>
          <div><p className={lbl}>Unit price €</p><input type="number" step="0.01" inputMode="decimal" value={f.unit_price} onChange={(e) => setF({ ...f, unit_price: e.target.value })} className={inp} /></div>
        </div>
        <div><p className={lbl}>Pack size (free text)</p><input value={f.pack_size} onChange={(e) => setF({ ...f, pack_size: e.target.value })} placeholder="5 kg box, 12 × 250 g, etc." className={inp} /></div>
        {err ? <p className="font-sans text-[13px] text-tomato">{err}</p> : null}
        <button disabled={busy} className="w-full rounded-xl px-5 py-4 font-sans text-[15px] font-medium text-[#F7F7F4]" style={{ background: "var(--accent)" }}>{busy ? "Saving…" : "Add to this supplier"}</button>
      </form>
    </main>
  );
}
