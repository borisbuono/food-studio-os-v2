"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabaseBrowser";

type Venue = { id: string; name: string };
const ROLES = ["worker", "chef", "maitre", "manager", "owner"];
const AREAS = ["Kitchen", "Floor", "Bar", "Office"];

// Manager-facing invite form. Inserts an invite row into team_members (status
// defaults to 'invited'); on first sign-in sync_my_profile_from_invite binds the
// person to this venue + role. The funnel's first step (see RELEASE_PLAN day 8).
export default function InviteTeammate({ venues }: { venues: Venue[] }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("worker");
  const [venueId, setVenueId] = useState(venues[0]?.id ?? "");
  const [area, setArea] = useState("Floor");
  const [lang, setLang] = useState("es");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit() {
    if (!name.trim() || !email.trim()) { setMsg({ ok: false, text: "Name and email are required." }); return; }
    setBusy(true); setMsg(null);
    const { error } = await supabaseBrowser.from("team_members").insert({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: phone.trim() || null,
      default_role: role,
      default_restaurant_id: venueId || null,
      default_area: area,
      language: lang,
      status: "invited",
    });
    setBusy(false);
    if (error) { setMsg({ ok: false, text: "Couldn't add — " + (error.message.includes("duplicate") ? "already invited." : "are you signed in?") }); return; }
    setMsg({ ok: true, text: name.trim() + " added — they get the venue + role on first sign-in." });
    setName(""); setEmail(""); setPhone("");
    setTimeout(() => location.reload(), 900);
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mt-6 w-full rounded-2xl border border-dashed border-line py-3 font-sans text-[14px] text-ink-soft transition hover:border-ink-soft">
        + Add to team
      </button>
    );
  }

  const field = "w-full rounded-xl border border-black/15 bg-paper px-3 py-2.5 font-sans text-[14px] text-ink";
  return (
    <div className="mt-6 rounded-2xl border border-line bg-card p-5">
      <p className="font-sans text-xs font-medium text-ink-soft">Invite a teammate</p>
      <div className="mt-3 space-y-2.5">
        <input className={field} placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className={field} placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className={field} placeholder="Phone (optional)" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <div className="grid grid-cols-2 gap-2.5">
          <select className={field} value={role} onChange={(e) => setRole(e.target.value)}>
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <select className={field} value={area} onChange={(e) => setArea(e.target.value)}>
            {AREAS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <select className={field} value={venueId} onChange={(e) => setVenueId(e.target.value)}>
            {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          <select className={field} value={lang} onChange={(e) => setLang(e.target.value)}>
            <option value="es">Español</option>
            <option value="en">English</option>
          </select>
        </div>
      </div>
      {msg ? <p className={"mt-3 font-sans text-[13px] " + (msg.ok ? "text-ink" : "text-clay")}>{msg.text}</p> : null}
      <div className="mt-4 flex gap-3">
        <button onClick={submit} disabled={busy} className="rounded-xl bg-[color:var(--accent)] px-5 py-2.5 font-sans text-[14px] font-medium text-[#F7F7F4] disabled:opacity-50">
          {busy ? "Adding…" : "Send invite"}
        </button>
        <button onClick={() => { setOpen(false); setMsg(null); }} className="rounded-xl border border-black/15 px-5 py-2.5 font-sans text-[14px] text-ink-soft">Cancel</button>
      </div>
    </div>
  );
}
