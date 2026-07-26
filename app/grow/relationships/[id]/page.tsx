"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabaseBrowser";

export const dynamic = "force-dynamic";

type Guest = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  allergies: string | null;
  dietary: string | null;
  birthday: string | null;
  notes: string | null;
  preferred_table: string | null;
  first_visit_at: string | null;
  last_visit_at: string | null;
  lifetime_value_eur: number | null;
  source: string;
};
type Visit = {
  id: string;
  visit_date: string;
  covers: number;
  spend_eur: number;
  sales_event_id: string | null;
  notes: string | null;
};

const eur = (n: number | null | undefined) => "€" + Math.round(Number(n || 0)).toLocaleString("en-GB");
const shortDate = (s: string | null) => (s ? new Date(s).toISOString().slice(0, 10) : "—");
const SOURCE_LABEL: Record<string, string> = {
  walk_in: "walk-in",
  booking: "booking",
  private_event: "private-event",
  referral: "referral",
};

export default function GuestProfile({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [g, setG] = useState<Guest | null>(null);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<Guest>>({});

  useEffect(() => {
    (async () => {
      const { data: gd } = await supabaseBrowser
        .from("guests")
        .select("id,name,email,phone,allergies,dietary,birthday,notes,preferred_table,first_visit_at,last_visit_at,lifetime_value_eur,source")
        .eq("id", params.id)
        .maybeSingle();
      setG(gd as Guest | null);
      setDraft(gd || {});
      const { data: vs } = await supabaseBrowser
        .from("guest_visits")
        .select("id,visit_date,covers,spend_eur,sales_event_id,notes")
        .eq("guest_id", params.id)
        .order("visit_date", { ascending: false })
        .limit(200);
      setVisits((vs || []) as Visit[]);
      setLoaded(true);
    })();
  }, [params.id]);

  const save = async () => {
    if (!g) return;
    setBusy(true); setErr(null);
    try {
      const payload: any = {
        allergies: draft.allergies || null,
        dietary: draft.dietary || null,
        birthday: draft.birthday || null,
        notes: draft.notes || null,
        email: draft.email || null,
        phone: draft.phone || null,
      };
      const { error } = await supabaseBrowser.from("guests").update(payload).eq("id", g.id);
      if (error) throw error;
      setG({ ...g, ...payload });
    } catch (e: any) { setErr(e?.message || "Save failed"); }
    setBusy(false);
  };

  const dirty = g && (
    (draft.allergies || "") !== (g.allergies || "") ||
    (draft.dietary || "") !== (g.dietary || "") ||
    (draft.birthday || "") !== (g.birthday || "") ||
    (draft.notes || "") !== (g.notes || "") ||
    (draft.email || "") !== (g.email || "") ||
    (draft.phone || "") !== (g.phone || "")
  );

  const visitsCount = visits.length;
  const recognise = g ? (() => {
    const bits: string[] = [];
    bits.push(g.name);
    if (visitsCount) bits.push(`${visitsCount}${["st","nd","rd"][((visitsCount+90)%100-10)%10-1] || "th"} visit`);
    if (g.allergies) bits.push(`allergic to ${g.allergies}`);
    if (g.dietary) bits.push(g.dietary);
    if (g.notes) bits.push(g.notes.split(/[.\n]/)[0]);
    return bits.join(" — ");
  })() : "";

  const lbl = "font-mono text-[10px] uppercase tracking-wide text-clay";
  const inp = "w-full bg-transparent font-sans text-[14px] text-ink placeholder:text-clay outline-none";

  if (!loaded) return <main className="mx-auto max-w-3xl lg:max-w-5xl px-6 py-12"><p className="font-mono text-[11px] text-clay">Loading…</p></main>;
  if (!g) return (
    <main className="mx-auto max-w-3xl lg:max-w-5xl px-6 py-12">
      <Link href="/grow/relationships" className="font-sans text-sm text-ink-soft">← guests</Link>
      <p className="mt-8 font-serif italic text-[16px] text-clay">Guest not found.</p>
    </main>
  );

  return (
    <main className="mx-auto max-w-3xl lg:max-w-5xl px-6 py-12">
      <Link href="/grow/relationships" className="font-sans text-sm text-ink-soft">← guests</Link>

      <div className="mt-6 flex items-baseline justify-between gap-6 border-b border-line pb-6">
        <div>
          <p className={lbl}>Grow · guest</p>
          <h1 className="mt-1 font-serif text-4xl leading-tight text-ink">{g.name}</h1>
          <p className="mt-1 font-mono text-[12px] text-clay">
            {[g.email, g.phone].filter(Boolean).join(" · ") || "—"}
          </p>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-clay">
            {SOURCE_LABEL[g.source] || g.source}
            {g.first_visit_at ? ` · first ${shortDate(g.first_visit_at)}` : ""}
          </p>
        </div>
        <div className="text-right">
          <p className={lbl}>LTV</p>
          <p className="mt-1 font-serif text-3xl text-ink">{eur(g.lifetime_value_eur)}</p>
          <p className="mt-1 font-mono text-[11px] text-clay">{visitsCount} visit{visitsCount === 1 ? "" : "s"}</p>
        </div>
      </div>

      {/* Recognise strip */}
      <section className="mt-6 border-l-2 pl-4" style={{ borderColor: "var(--accent)" }}>
        <p className={lbl}>Recognise</p>
        <p className="mt-1 font-serif italic text-[15px] text-ink-soft leading-snug">{recognise}</p>
      </section>

      {/* Editable panel */}
      <section className="mt-8">
        <p className={lbl}>Details</p>
        <div className="mt-2 divide-y divide-line border-y border-line">
          <div className="flex items-baseline gap-3 py-2.5">
            <span className={lbl + " w-28"}>Email</span>
            <input value={draft.email || ""} onChange={(e) => setDraft({ ...draft, email: e.target.value })} placeholder="—" className={inp} />
          </div>
          <div className="flex items-baseline gap-3 py-2.5">
            <span className={lbl + " w-28"}>Phone</span>
            <input value={draft.phone || ""} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} placeholder="—" className={inp} />
          </div>
          <div className="flex items-baseline gap-3 py-2.5">
            <span className={lbl + " w-28"}>Birthday</span>
            <input type="date" value={draft.birthday || ""} onChange={(e) => setDraft({ ...draft, birthday: e.target.value })} className={inp + " font-mono text-[13px]"} />
          </div>
          <div className="flex items-baseline gap-3 py-2.5">
            <span className={lbl + " w-28"}>Allergies</span>
            <input value={draft.allergies || ""} onChange={(e) => setDraft({ ...draft, allergies: e.target.value })} placeholder="shellfish, nuts…" className={inp} />
          </div>
          <div className="flex items-baseline gap-3 py-2.5">
            <span className={lbl + " w-28"}>Dietary</span>
            <input value={draft.dietary || ""} onChange={(e) => setDraft({ ...draft, dietary: e.target.value })} placeholder="vegetarian, halal…" className={inp} />
          </div>
          <div className="flex items-baseline gap-3 py-2.5">
            <span className={lbl + " w-28"}>Notes</span>
            <textarea value={draft.notes || ""} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} rows={3} placeholder="Preferences, stories, anything worth remembering." className={inp + " resize-none"} />
          </div>
        </div>
        {err ? <p className="mt-3 font-mono text-[11px] text-tomato">⚠ {err}</p> : null}
        {dirty ? (
          <button onClick={save} disabled={busy} className="mt-4 rounded-xl px-4 py-2.5 font-sans text-[13px] font-medium text-[#F7F7F4]" style={{ background: "var(--accent)" }}>
            {busy ? "Saving…" : "Save changes"}
          </button>
        ) : null}
      </section>

      {/* Visit history */}
      <section className="mt-10">
        <p className={lbl}>Visit history</p>
        {visits.length === 0 ? (
          <p className="mt-3 py-4 font-serif italic text-[14px] text-clay border-y border-line">No visits logged yet.</p>
        ) : (
          <div className="mt-3 border-y border-line">
            <div className="grid grid-cols-[0.7fr_0.4fr_0.6fr_0.5fr_1fr] items-baseline gap-3 border-b border-line py-2">
              <span className={lbl}>Date</span>
              <span className={lbl + " text-right"}>Covers</span>
              <span className={lbl + " text-right"}>Spend</span>
              <span className={lbl}>Event</span>
              <span className={lbl}>Notes</span>
            </div>
            <ul className="divide-y divide-line">
              {visits.map((v) => (
                <li key={v.id} className="grid grid-cols-[0.7fr_0.4fr_0.6fr_0.5fr_1fr] items-baseline gap-3 py-2.5">
                  <span className="font-mono text-[12px] text-ink">{v.visit_date}</span>
                  <span className="text-right font-mono text-[12px] text-ink-soft">{v.covers}</span>
                  <span className="text-right font-mono text-[12px] text-ink">{eur(v.spend_eur)}</span>
                  <span className="font-mono text-[11px] text-clay">
                    {v.sales_event_id ? <Link href={`/administrate/events`} className="text-tomato hover:text-ink">private ›</Link> : "—"}
                  </span>
                  <span className="font-sans text-[13px] text-ink-soft truncate">{v.notes || "—"}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </main>
  );
}
