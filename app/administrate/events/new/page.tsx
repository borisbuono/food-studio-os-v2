"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { getMyProfile } from "@/lib/profile";
import { ENTITY_TO_RESTAURANT, EntityKey } from "@/lib/entities";

const STATUSES = ["enquiry", "proposal", "confirmed"];
const TYPES = ["private dinner", "catering", "wedding", "corporate", "wine pairing", "tasting menu"];

export default function NewEvent() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({
    title: "",
    event_type: TYPES[0],
    status: "enquiry",
    client_name: "",
    event_date: "",
    guests_count: "",
    estimated_revenue: "",
    estimated_gp_pct: "",
    theme: "",
  });

  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      const prof = await getMyProfile();
      const ent = (prof && !prof.isAdmin ? prof.entity : ((typeof localStorage !== "undefined" && localStorage.getItem("fs_entity")) as EntityKey | null)) || "utopia";
      const rid = prof?.restaurantId || ENTITY_TO_RESTAURANT[ent as EntityKey] || ENTITY_TO_RESTAURANT.utopia!;
      const payload: any = {
        restaurant_id: rid,
        title: f.title || null,
        event_type: f.event_type || null,
        status: f.status,
        client_name: f.client_name || null,
        event_date: f.event_date || null,
        theme: f.theme || null,
      };
      if (f.guests_count) payload.guests_count = Number(f.guests_count);
      if (f.estimated_revenue) payload.estimated_revenue = Number(f.estimated_revenue);
      if (f.estimated_gp_pct) payload.estimated_gp_pct = Number(f.estimated_gp_pct);
      const { error } = await supabaseBrowser.from("sales_events").insert(payload);
      if (error) throw error;
      router.push("/administrate/events");
    } catch (e: any) {
      setErr(e.message || "Couldn't save — sign in?"); setBusy(false);
    }
  }

  const inp = "mt-1 w-full rounded-xl border border-black/15 bg-card px-4 py-3 font-sans text-[14px] text-ink";
  const lbl = "font-mono text-[10px] uppercase tracking-wide text-clay";

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/administrate/events" className="font-sans text-sm text-ink-soft">← events</Link>
      <p className="mt-6 font-sans text-xs font-medium text-ochre">New event</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">Capture an enquiry</h1>

      <form onSubmit={save} className="mt-8 space-y-4">
        <div><p className={lbl}>Title</p><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Birthday for the Calleja party" className={inp} required /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><p className={lbl}>Type</p><select value={f.event_type} onChange={(e) => setF({ ...f, event_type: e.target.value })} className={inp}>{TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
          <div><p className={lbl}>Status</p><select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} className={inp}>{STATUSES.map((t) => <option key={t}>{t}</option>)}</select></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><p className={lbl}>Client</p><input value={f.client_name} onChange={(e) => setF({ ...f, client_name: e.target.value })} className={inp} /></div>
          <div><p className={lbl}>Date</p><input type="date" value={f.event_date} onChange={(e) => setF({ ...f, event_date: e.target.value })} className={inp} /></div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div><p className={lbl}>Guests</p><input type="number" inputMode="numeric" value={f.guests_count} onChange={(e) => setF({ ...f, guests_count: e.target.value })} className={inp} /></div>
          <div><p className={lbl}>Revenue est. €</p><input type="number" inputMode="numeric" value={f.estimated_revenue} onChange={(e) => setF({ ...f, estimated_revenue: e.target.value })} className={inp} /></div>
          <div><p className={lbl}>GP %</p><input type="number" inputMode="numeric" value={f.estimated_gp_pct} onChange={(e) => setF({ ...f, estimated_gp_pct: e.target.value })} className={inp} /></div>
        </div>
        <div><p className={lbl}>Theme / notes</p><textarea value={f.theme} onChange={(e) => setF({ ...f, theme: e.target.value })} rows={3} className={inp} /></div>

        {err ? <p className="font-sans text-[13px] text-tomato">{err}</p> : null}
        <button disabled={busy} className="w-full rounded-xl px-5 py-4 font-sans text-[15px] font-medium text-[#FCEFE7]" style={{ background: "var(--accent)" }}>
          {busy ? "Saving…" : "Save event"}
        </button>
      </form>
    </main>
  );
}
