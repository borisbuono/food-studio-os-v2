"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabaseBrowser";

const ROLES = ["worker", "chef", "maitre", "manager", "owner"];

export default function InviteToTeam() {
  const [venues, setVenues] = useState<{ id: string; name: string }[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("worker");
  const [venue, setVenue] = useState("");
  const [lang, setLang] = useState("es");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    supabaseBrowser.from("restaurants").select("id,name").then(({ data }) => {
      const v = data || [];
      setVenues(v);
      if (v[0] && !venue) setVenue(v[0].id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    setErr(null);
    if (!name.trim() || !email.trim()) { setErr("Name and email are required — the email is how they sign in."); return; }
    setBusy(true);
    const base: any = {
      name: name.trim(),
      email: email.trim().toLowerCase(),
      default_role: role,
      default_restaurant_id: venue || null,
      language: lang,
      status: "invited",
      invited_at: new Date().toISOString(),
    };
    // phone column lands with the 20260611 migration; degrade gracefully if it hasn't run yet
    let { error } = await supabaseBrowser.from("team_members").insert({ ...base, phone: phone.trim() || null });
    if (error && /phone/.test(error.message)) ({ error } = await supabaseBrowser.from("team_members").insert(base));
    setBusy(false);
    if (error) { setErr(error.message.includes("row-level security") ? "Couldn't save — are you signed in as a manager?" : error.message); return; }
    setDone(true);
  }

  const loginUrl = "https://food-studio-os-v2.vercel.app/login";
  const inviteMsg = `Hola ${name.split(" ")[0] || ""}! You're invited to the Food Studio OS. Sign in here with this email (${email}): ${loginUrl} — your venue and role are already set up for you.`;

  if (done)
    return (
      <main className="mx-auto max-w-xl px-6 py-12">
        <Link href="/administrate/team" className="font-sans text-sm text-ink-soft">← team</Link>
        <p className="mt-6 font-sans text-xs font-medium" style={{ color: "var(--accent)" }}>Invite saved</p>
        <h1 className="mt-2 font-serif text-3xl text-ink">{name} is on the roster</h1>
        <p className="mt-3 font-serif text-[17px] leading-relaxed text-ink-soft">
          When they first sign in with <span className="font-medium text-ink">{email}</span>, the OS binds them to their venue and role automatically and walks them through a 60-second first run. Send them the link:
        </p>
        <div className="mt-6 border-y border-line py-4">
          <p className="font-sans text-[14px] leading-relaxed text-ink">{inviteMsg}</p>
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          {phone ? (
            <a href={"https://wa.me/" + phone.replace(/[^\d]/g, "") + "?text=" + encodeURIComponent(inviteMsg)} className="rounded-xl px-5 py-3 font-sans text-[14px] font-medium text-[#F7F7F4]" style={{ background: "var(--accent)" }}>Send on WhatsApp</a>
          ) : null}
          <a href={"mailto:" + email + "?subject=" + encodeURIComponent("Your Food Studio OS sign-in") + "&body=" + encodeURIComponent(inviteMsg)} className="rounded-xl border border-black/15 px-5 py-3 font-sans text-[14px] text-ink">Send by email</a>
          <button onClick={() => { setDone(false); setName(""); setEmail(""); setPhone(""); }} className="px-2 py-3 font-sans text-[14px] text-ink-soft">+ Invite another</button>
        </div>
      </main>
    );

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/administrate/team" className="font-sans text-sm text-ink-soft">← team</Link>
      <p className="mt-6 font-sans text-xs font-medium" style={{ color: "var(--accent)" }}>Team · invite</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">Add to the team</h1>
      <p className="mt-2 font-sans text-[14px] text-ink-soft">They get a sign-in link; venue + role bind automatically on first sign-in.</p>

      <div className="mt-8 space-y-4">
        <label className="block">
          <span className="font-mono text-[11px] uppercase tracking-wide text-clay">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-xl border border-black/15 bg-transparent px-4 py-3 font-sans text-[15px] text-ink" placeholder="Full name" />
        </label>
        <label className="block">
          <span className="font-mono text-[11px] uppercase tracking-wide text-clay">Email (their sign-in)</span>
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className="mt-1 w-full rounded-xl border border-black/15 bg-transparent px-4 py-3 font-sans text-[15px] text-ink" placeholder="name@example.com" />
        </label>
        <label className="block">
          <span className="font-mono text-[11px] uppercase tracking-wide text-clay">Phone (for the WhatsApp invite)</span>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-1 w-full rounded-xl border border-black/15 bg-transparent px-4 py-3 font-sans text-[15px] text-ink" placeholder="+34 …" />
        </label>
        <div className="flex gap-4">
          <label className="block flex-1">
            <span className="font-mono text-[11px] uppercase tracking-wide text-clay">Role</span>
            <select value={role} onChange={(e) => setRole(e.target.value)} className="mt-1 w-full rounded-xl border border-black/15 bg-transparent px-4 py-3 font-sans text-[15px] text-ink">
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <label className="block flex-1">
            <span className="font-mono text-[11px] uppercase tracking-wide text-clay">Venue</span>
            <select value={venue} onChange={(e) => setVenue(e.target.value)} className="mt-1 w-full rounded-xl border border-black/15 bg-transparent px-4 py-3 font-sans text-[15px] text-ink">
              {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </label>
        </div>
        <label className="block">
          <span className="font-mono text-[11px] uppercase tracking-wide text-clay">Language</span>
          <select value={lang} onChange={(e) => setLang(e.target.value)} className="mt-1 w-full rounded-xl border border-black/15 bg-transparent px-4 py-3 font-sans text-[15px] text-ink">
            <option value="es">Español</option>
            <option value="en">English</option>
          </select>
        </label>
      </div>

      {err ? <p className="mt-4 font-sans text-[13px] text-tomato">{err}</p> : null}
      <button onClick={save} disabled={busy} className="mt-6 rounded-xl px-6 py-3 font-sans text-[14px] font-medium text-[#F7F7F4] disabled:opacity-50" style={{ background: "var(--accent)" }}>
        {busy ? "Saving…" : "Save + get the invite link"}
      </button>
    </main>
  );
}
