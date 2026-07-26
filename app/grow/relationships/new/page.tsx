"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { getMyProfile } from "@/lib/profile";
import { ENTITY_TO_RESTAURANT, EntityKey } from "@/lib/entities";

const SOURCES = [
  { value: "walk_in", label: "Walk-in" },
  { value: "booking", label: "Booking" },
  { value: "private_event", label: "Private event" },
  { value: "referral", label: "Referral" },
];

export default function NewGuest() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({
    name: "",
    email: "",
    phone: "",
    birthday: "",
    allergies: "",
    dietary: "",
    notes: "",
    source: "walk_in",
  });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const prof = await getMyProfile();
      const ent = (prof && !prof.isAdmin ? prof.entity : ((typeof localStorage !== "undefined" && localStorage.getItem("fs_entity")) as EntityKey | null)) || "utopia";
      const rid = prof?.restaurantId || ENTITY_TO_RESTAURANT[ent as EntityKey] || ENTITY_TO_RESTAURANT.utopia!;
      const payload: any = {
        restaurant_id: rid,
        name: f.name.trim(),
        email: f.email || null,
        phone: f.phone || null,
        birthday: f.birthday || null,
        allergies: f.allergies || null,
        dietary: f.dietary || null,
        notes: f.notes || null,
        source: f.source,
      };
      const { data, error } = await supabaseBrowser.from("guests").insert(payload).select("id").maybeSingle();
      if (error) throw error;
      router.push(data?.id ? `/grow/relationships/${data.id}` : "/grow/relationships");
    } catch (e: any) {
      setErr(e?.message || "Couldn't save — sign in?"); setBusy(false);
    }
  }

  const lbl = "font-mono text-[10px] uppercase tracking-wide text-clay";
  const inp = "mt-1 w-full border-b border-line bg-transparent py-2 font-sans text-[15px] text-ink placeholder:text-clay outline-none focus:border-ink";

  return (
    <main className="mx-auto max-w-xl lg:max-w-4xl px-6 py-12">
      <Link href="/grow/relationships" className="font-sans text-sm text-ink-soft">← guests</Link>
      <p className="mt-6 font-mono text-[10px] uppercase tracking-wide text-clay">Grow · relationships</p>
      <h1 className="mt-1 font-serif text-4xl leading-tight text-ink">Add a guest.</h1>
      <p className="mt-2 font-serif italic text-[14px] text-ink-soft">Name is enough. The rest — email, allergies, notes — fills in as you learn them.</p>

      <form onSubmit={save} className="mt-8 space-y-5">
        <div>
          <p className={lbl}>Name*</p>
          <input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Alberto Puig" className={inp} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className={lbl}>Email</p>
            <input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} className={inp} />
          </div>
          <div>
            <p className={lbl}>Phone</p>
            <input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} className={inp} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className={lbl}>Birthday</p>
            <input type="date" value={f.birthday} onChange={(e) => setF({ ...f, birthday: e.target.value })} className={inp + " font-mono text-[13px]"} />
          </div>
          <div>
            <p className={lbl}>Source</p>
            <select value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} className={inp}>
              {SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
        </div>
        <div>
          <p className={lbl}>Allergies</p>
          <input value={f.allergies} onChange={(e) => setF({ ...f, allergies: e.target.value })} placeholder="shellfish, nuts…" className={inp} />
        </div>
        <div>
          <p className={lbl}>Dietary</p>
          <input value={f.dietary} onChange={(e) => setF({ ...f, dietary: e.target.value })} placeholder="vegetarian, halal, wine club…" className={inp} />
        </div>
        <div>
          <p className={lbl}>Notes</p>
          <textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} rows={3} placeholder="Prefers table 3. Red wine. Owner's friend." className={inp + " resize-none"} />
        </div>

        {err ? <p className="font-mono text-[12px] text-tomato">⚠ {err}</p> : null}
        <button disabled={busy || !f.name.trim()} className="w-full rounded-xl px-5 py-4 font-sans text-[15px] font-medium text-[#F7F7F4] disabled:opacity-60" style={{ background: "var(--accent)" }}>
          {busy ? "Saving…" : "Save guest"}
        </button>
      </form>
    </main>
  );
}
