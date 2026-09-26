"use client";
import { useState } from "react";
import Link from "next/link";

const WEEK: [string, string][] = [["mon", "Mon"], ["tue", "Tue"], ["wed", "Wed"], ["thu", "Thu"], ["fri", "Fri"], ["sat", "Sat"], ["sun", "Sun"]];
const DEFAULT_HOURS: Record<string, [string, string][]> = {
  mon: [["10:00", "13:00"], ["16:00", "18:00"]], tue: [["10:00", "13:00"], ["16:00", "18:00"]],
  wed: [["10:00", "13:00"], ["16:00", "18:00"]], thu: [["10:00", "13:00"], ["16:00", "18:00"]],
  fri: [["10:00", "13:00"], ["16:00", "18:00"]], sat: [], sun: [],
};
const toText = (ws: [string, string][] | undefined) => (ws || []).map((w) => `${w[0]}-${w[1]}`).join(", ");
const fromText = (s: string): [string, string][] =>
  s.split(",").map((x) => x.trim()).filter(Boolean).map((x) => x.split("-").map((y) => y.trim()) as [string, string])
    .filter((w) => w.length === 2 && /^\d{2}:\d{2}$/.test(w[0]) && /^\d{2}:\d{2}$/.test(w[1]));
const slugify = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

export default function BookingSettings({ initial, venues, myName, hasPerson }: {
  initial: any | null; venues: { id: string; slug: string; name: string }[]; myName: string; hasPerson: boolean;
}) {
  const [p, setP] = useState(() => ({
    slug: initial?.slug || slugify(myName.split(" ")[0] || "me"),
    entity_id: initial?.entity_id || venues[0]?.id || "",
    display_name: initial?.display_name || myName.split(" ")[0] || "",
    intro: initial?.intro || "",
    location: initial?.location || "",
    slot_minutes: initial?.slot_minutes ?? 30,
    buffer_minutes: initial?.buffer_minutes ?? 15,
    min_notice_hours: initial?.min_notice_hours ?? 12,
    days_ahead: initial?.days_ahead ?? 14,
    active: initial?.active ?? true,
  }));
  const [hours, setHours] = useState<Record<string, string>>(() =>
    Object.fromEntries(WEEK.map(([k]) => [k, toText((initial?.hours || DEFAULT_HOURS)[k])])));
  const [msg, setMsg] = useState<string | null>(null);
  const [saved, setSaved] = useState<boolean>(!!initial);

  if (!hasPerson) return <p className="text-sm text-clay">Your login isn't linked to a team member yet, so there's no calendar to book against.</p>;
  if (!venues.length) return <p className="text-sm text-clay">You need a venue membership before you can take bookings.</p>;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    const body = { ...p, hours: Object.fromEntries(WEEK.map(([k]) => [k, fromText(hours[k] || "")])) };
    const r = await fetch("/api/me/booking", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (j.ok) { setSaved(true); setMsg("Saved."); } else setMsg(j.error || "Not saved");
  };
  const link = `https://foodstudio.ai/book/${p.slug}`;
  const input = "w-full rounded border border-black/15 bg-white px-2 py-1.5 text-sm";

  return (
    <form onSubmit={save} className="space-y-4">
      <div className="flex items-end justify-between border-b border-black/10 pb-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">My booking page</p>
          <h1 className="font-serif text-2xl">Book time with {p.display_name || "me"}</h1>
        </div>
        <Link href="/me/today?tab=calendar" className="rounded border border-black/15 px-2 py-1 text-xs">Calendar</Link>
      </div>
      {saved ? (
        <p className="text-sm">Link: <span className="select-all font-mono">{link}</span>{" "}
          <a href={`/book/${p.slug}`} target="_blank" className="underline">open ↗</a></p>
      ) : null}
      <label className="block text-xs text-clay">Link<input className={input} value={p.slug} onChange={(e) => setP({ ...p, slug: slugify(e.target.value) })} /></label>
      <label className="block text-xs text-clay">Name shown<input className={input} value={p.display_name} onChange={(e) => setP({ ...p, display_name: e.target.value })} /></label>
      <label className="block text-xs text-clay">Venue (timezone + where)
        <select className={input} value={p.entity_id} onChange={(e) => setP({ ...p, entity_id: e.target.value })}>
          {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      </label>
      <label className="block text-xs text-clay">Where (address or "call")<input className={input} value={p.location} onChange={(e) => setP({ ...p, location: e.target.value })} /></label>
      <label className="block text-xs text-clay">Short line for visitors (optional)<textarea className={input} rows={2} value={p.intro} onChange={(e) => setP({ ...p, intro: e.target.value })} /></label>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="block text-xs text-clay">Slot (min)<input type="number" className={input} value={p.slot_minutes} onChange={(e) => setP({ ...p, slot_minutes: Number(e.target.value) })} /></label>
        <label className="block text-xs text-clay">Buffer (min)<input type="number" className={input} value={p.buffer_minutes} onChange={(e) => setP({ ...p, buffer_minutes: Number(e.target.value) })} /></label>
        <label className="block text-xs text-clay">Notice (h)<input type="number" className={input} value={p.min_notice_hours} onChange={(e) => setP({ ...p, min_notice_hours: Number(e.target.value) })} /></label>
        <label className="block text-xs text-clay">Days ahead<input type="number" className={input} value={p.days_ahead} onChange={(e) => setP({ ...p, days_ahead: Number(e.target.value) })} /></label>
      </div>
      <fieldset className="space-y-1.5">
        <legend className="text-xs text-clay">Hours (local time, e.g. 10:00-13:00, 16:00-18:00 — empty = closed)</legend>
        {WEEK.map(([k, label]) => (
          <label key={k} className="flex items-center gap-2 text-sm">
            <span className="w-10 font-mono text-xs">{label}</span>
            <input className={input} value={hours[k]} onChange={(e) => setHours({ ...hours, [k]: e.target.value })} />
          </label>
        ))}
      </fieldset>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={p.active} onChange={(e) => setP({ ...p, active: e.target.checked })} /> Page is live</label>
      <p className="text-xs text-clay">Free time = these hours minus your shifts, interviews, meetings and Google calendar (if connected), with the buffer either side.</p>
      {msg ? <p className="text-sm">{msg}</p> : null}
      <button className="rounded bg-ink px-4 py-2 text-sm text-white">Save</button>
    </form>
  );
}
