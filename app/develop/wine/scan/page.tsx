"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { getMyProfile } from "@/lib/profile";
import { ENTITY_TO_RESTAURANT, EntityKey } from "@/lib/entities";

type Wine = { name: string; producer: string; region: string; grape: string; vintage: string; wine_style: string; tasting_notes: string; pitch: string; description: string };
const EMPTY: Wine = { name: "", producer: "", region: "", grape: "", vintage: "", wine_style: "", tasting_notes: "", pitch: "", description: "" };
const STYLES = ["sparkling", "white", "orange", "rose", "red", "sweet", "fortified"];

// downscale to keep the upload small + fast
function downscale(file: File): Promise<{ data: string; media_type: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const max = 1280; let { width, height } = img;
      if (width > max || height > max) { const s = max / Math.max(width, height); width = Math.round(width * s); height = Math.round(height * s); }
      const c = document.createElement("canvas"); c.width = width; c.height = height;
      c.getContext("2d")!.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      const dataUrl = c.toDataURL("image/jpeg", 0.82);
      resolve({ data: dataUrl.split(",")[1], media_type: "image/jpeg" });
    };
    img.onerror = reject; img.src = url;
  });
}

export default function ScanWine() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [w, setW] = useState<Wine | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [vintageFlag, setVintageFlag] = useState<string | null>(null);

  const onPick = async (file?: File | null) => {
    if (!file) return;
    setErr(""); setW(null); setSaved(null); setVintageFlag(null); setBusy(true);
    setPreview(URL.createObjectURL(file));
    try {
      const { data, media_type } = await downscale(file);
      const r = await fetch("/api/wine-scan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image: data, media_type }) });
      const d = await r.json();
      if (!d.ok) { setErr(d.error || "Couldn't read the label."); }
      else { setW({ ...EMPTY, ...d.wine }); }
    } catch (e: any) { setErr("Scan failed: " + (e?.message || "")); }
    setBusy(false);
  };

  const save = async () => {
    if (!w) return;
    setBusy(true); setErr("");
    const p = await getMyProfile();
    const ent = (p && !p.isAdmin ? p.entity : ((localStorage.getItem("fs_entity") as EntityKey) || "utopia")) || "utopia";
    const rid = p?.restaurantId || ENTITY_TO_RESTAURANT[ent as EntityKey] || ENTITY_TO_RESTAURANT.utopia!;
    // does this wine already exist in the cellar? (vintage-change detection)
    const { data: existing } = await supabaseBrowser.from("menu_items").select("id,vintage").eq("restaurant_id", rid).eq("section", "wine").ilike("name", w.name).maybeSingle();
    const fields: any = { name: w.name, producer: w.producer || null, region: w.region || null, vintage: w.vintage || null, wine_style: w.wine_style || "to_classify", tasting_notes: w.tasting_notes || null, pitch: w.pitch || null, description: [w.description, w.grape ? "Grape: " + w.grape : ""].filter(Boolean).join("\n\n") || null };
    try {
      if (existing) {
        if (existing.vintage && w.vintage && String(existing.vintage) !== String(w.vintage)) setVintageFlag(`Vintage changed ${existing.vintage} → ${w.vintage} — re-cost & re-taste before it goes out.`);
        await supabaseBrowser.from("menu_items").update(fields).eq("id", existing.id);
        setSaved(existing.id);
      } else {
        const { data: ins } = await supabaseBrowser.from("menu_items").insert({ ...fields, restaurant_id: rid, category: "drink", section: "wine", is_active: true }).select("id").maybeSingle();
        setSaved(ins?.id || "new");
      }
    } catch (e: any) { setErr("Couldn't save: " + (e?.message || "")); }
    setBusy(false);
  };

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/develop/wine" className="font-sans text-sm text-ink-soft">← cellar</Link>
      <p className="mt-6 font-sans text-xs font-medium text-tomato">Cellar · scan a label</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">Add a wine from its label</h1>
      <p className="mt-2 font-sans text-[14px] leading-relaxed text-ink-soft">Photograph the front label. Chef reads it and drafts the wine — grape, area, producer, vintage, style, tasting and a pitch. You check it, then save to the cellar.</p>

      <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onPick(e.target.files?.[0])} />
      <button onClick={() => fileRef.current?.click()} disabled={busy} className="mt-6 w-full rounded-xl px-6 py-4 font-sans text-[15px] font-medium text-[#FCEFE7] disabled:opacity-60" style={{ background: "var(--accent)" }}>{busy && !w ? "Reading the label…" : "Take / choose a photo"}</button>
      {preview ? <img src={preview} alt="label" className="mt-4 max-h-52 rounded-xl border border-black/10 object-contain" /> : null}
      {err ? <p className="mt-3 font-mono text-[11px] text-ember">{err}</p> : null}

      {w ? (
        <div className="mt-6 rounded-2xl border border-black/10 bg-card p-5">
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Check & edit, then save</p>
          {([["name", "Name"], ["producer", "Producer"], ["region", "Region / area"], ["grape", "Grape(s)"], ["vintage", "Vintage"]] as const).map(([k, label]) => (
            <label key={k} className="mt-3 block">
              <span className="font-mono text-[10px] uppercase tracking-wide text-clay">{label}</span>
              <input value={(w as any)[k]} onChange={(e) => setW({ ...w, [k]: e.target.value })} className="mt-1 w-full rounded-lg border border-black/15 bg-paper px-3 py-2 font-sans text-[15px] text-ink outline-none focus:border-ember" />
            </label>
          ))}
          <label className="mt-3 block"><span className="font-mono text-[10px] uppercase tracking-wide text-clay">Style</span>
            <select value={w.wine_style} onChange={(e) => setW({ ...w, wine_style: e.target.value })} className="mt-1 w-full rounded-lg border border-black/15 bg-paper px-3 py-2 font-sans text-[15px] text-ink">
              <option value="">—</option>{STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          {(["tasting_notes", "pitch", "description"] as const).map((k) => (
            <label key={k} className="mt-3 block"><span className="font-mono text-[10px] uppercase tracking-wide text-clay">{k.replace("_", " ")}</span>
              <textarea value={(w as any)[k]} onChange={(e) => setW({ ...w, [k]: e.target.value })} className="mt-1 h-20 w-full rounded-lg border border-black/15 bg-paper px-3 py-2 font-serif text-[15px] leading-relaxed text-ink outline-none focus:border-ember" />
            </label>
          ))}
          <button onClick={save} disabled={busy || !w.name} className="mt-4 w-full rounded-xl px-6 py-3 font-sans text-[14px] font-medium text-[#FCEFE7] disabled:opacity-60" style={{ background: "var(--accent)" }}>{busy ? "Saving…" : "Save to cellar"}</button>
        </div>
      ) : null}

      {vintageFlag ? <p className="mt-4 rounded-xl border border-tomato/40 bg-tomato/5 p-3 font-sans text-[13px] text-tomato">{vintageFlag}</p> : null}
      {saved ? (
        <div className="mt-4 rounded-xl border border-black/10 bg-card p-4">
          <p className="font-serif text-[16px] text-ink">Saved to the cellar.</p>
          <div className="mt-3 flex gap-3">
            <Link href={"/develop/wine/" + saved} className="rounded-xl px-4 py-2 font-sans text-[13px] font-medium text-[#FCEFE7]" style={{ background: "var(--accent)" }}>Open the wine</Link>
            <Link href="/develop/wine" className="rounded-xl border border-black/15 px-4 py-2 font-sans text-[13px] text-ink-soft">Back to cellar</Link>
          </div>
        </div>
      ) : null}
    </main>
  );
}
