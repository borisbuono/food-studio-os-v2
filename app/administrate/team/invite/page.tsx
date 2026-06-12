"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { t, getLang, Lang } from "@/lib/i18n";

const ROLES = ["worker", "chef", "maitre", "manager", "owner"];

// foodstudio.ai cut over to v2 on 2026-06-10 — invites point at the real domain now
const LOGIN_URL = "https://foodstudio.ai/login";

export default function InviteToTeam() {
  const [venues, setVenues] = useState<{ id: string; name: string }[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("worker");
  const [venue, setVenue] = useState("");
  const [lang, setLang] = useState("es");      // invitee's language (saved on the invite)
  const [ui, setUi] = useState<Lang>("en");    // manager's UI language (fs_lang cookie)
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const tr = (key: string) => t(key, ui);

  useEffect(() => {
    setUi(getLang());
    supabaseBrowser.from("restaurants").select("id,name").then(({ data }) => {
      const v = data || [];
      setVenues(v);
      if (v[0] && !venue) setVenue(v[0].id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    setErr(null);
    if (!name.trim() || !email.trim()) { setErr(tr("invite.err.required")); return; }
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
    if (error) { setErr(error.message.includes("row-level security") ? tr("invite.err.rls") : error.message); return; }
    setDone(true);
  }

  // The invite message goes out in the INVITEE's language, not the manager's
  const first = name.split(" ")[0] || "";
  const inviteMsg = lang === "es"
    ? `Hola ${first}! Te invitamos al Food Studio OS. Entra aquí con este email (${email}): ${LOGIN_URL} — tu local y tu puesto ya están configurados.`
    : `Hi ${first}! You're invited to the Food Studio OS. Sign in here with this email (${email}): ${LOGIN_URL} — your venue and role are already set up for you.`;

  if (done)
    return (
      <main className="mx-auto max-w-xl px-6 py-12">
        <Link href="/administrate/team" className="font-sans text-sm text-ink-soft">{tr("invite.back")}</Link>
        <p className="mt-6 font-sans text-xs font-medium" style={{ color: "var(--accent)" }}>{tr("invite.saved")}</p>
        <h1 className="mt-2 font-serif text-3xl text-ink">{t("invite.saved.title", ui).replace("{name}", name)}</h1>
        <p className="mt-3 font-serif text-[17px] leading-relaxed text-ink-soft">
          {tr("invite.saved.body.a")} <span className="font-medium text-ink">{email}</span>{tr("invite.saved.body.b")}
        </p>
        <div className="mt-6 border-y border-line py-4">
          <p className="font-sans text-[14px] leading-relaxed text-ink">{inviteMsg}</p>
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          {phone ? (
            <a href={"https://wa.me/" + phone.replace(/[^\d]/g, "") + "?text=" + encodeURIComponent(inviteMsg)} className="rounded-xl px-5 py-3 font-sans text-[14px] font-medium text-[#F7F7F4]" style={{ background: "var(--accent)" }}>{tr("invite.wa")}</a>
          ) : null}
          <a href={"mailto:" + email + "?subject=" + encodeURIComponent(tr("invite.mail.subject")) + "&body=" + encodeURIComponent(inviteMsg)} className="rounded-xl border border-black/15 px-5 py-3 font-sans text-[14px] text-ink">{tr("invite.mail")}</a>
          <button onClick={() => { setDone(false); setName(""); setEmail(""); setPhone(""); }} className="px-2 py-3 font-sans text-[14px] text-ink-soft">{tr("invite.another")}</button>
        </div>
      </main>
    );

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/administrate/team" className="font-sans text-sm text-ink-soft">{tr("invite.back")}</Link>
      <p className="mt-6 font-sans text-xs font-medium" style={{ color: "var(--accent)" }}>{tr("invite.eyebrow")}</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">{tr("invite.title")}</h1>
      <p className="mt-2 font-sans text-[14px] text-ink-soft">{tr("invite.sub")}</p>

      <div className="mt-8 space-y-4">
        <label className="block">
          <span className="font-mono text-[11px] uppercase tracking-wide text-clay">{tr("invite.name")}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-xl border border-black/15 bg-transparent px-4 py-3 font-sans text-[15px] text-ink" placeholder={tr("invite.name.ph")} />
        </label>
        <label className="block">
          <span className="font-mono text-[11px] uppercase tracking-wide text-clay">{tr("invite.email")}</span>
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className="mt-1 w-full rounded-xl border border-black/15 bg-transparent px-4 py-3 font-sans text-[15px] text-ink" placeholder="name@example.com" />
        </label>
        <label className="block">
          <span className="font-mono text-[11px] uppercase tracking-wide text-clay">{tr("invite.phone")}</span>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-1 w-full rounded-xl border border-black/15 bg-transparent px-4 py-3 font-sans text-[15px] text-ink" placeholder="+34 …" />
        </label>
        <div className="flex gap-4">
          <label className="block flex-1">
            <span className="font-mono text-[11px] uppercase tracking-wide text-clay">{tr("invite.role")}</span>
            <select value={role} onChange={(e) => setRole(e.target.value)} className="mt-1 w-full rounded-xl border border-black/15 bg-transparent px-4 py-3 font-sans text-[15px] text-ink">
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <label className="block flex-1">
            <span className="font-mono text-[11px] uppercase tracking-wide text-clay">{tr("invite.venue")}</span>
            <select value={venue} onChange={(e) => setVenue(e.target.value)} className="mt-1 w-full rounded-xl border border-black/15 bg-transparent px-4 py-3 font-sans text-[15px] text-ink">
              {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </label>
        </div>
        <label className="block">
          <span className="font-mono text-[11px] uppercase tracking-wide text-clay">{tr("invite.lang")}</span>
          <select value={lang} onChange={(e) => setLang(e.target.value)} className="mt-1 w-full rounded-xl border border-black/15 bg-transparent px-4 py-3 font-sans text-[15px] text-ink">
            <option value="es">Español</option>
            <option value="en">English</option>
          </select>
        </label>
      </div>

      {err ? <p className="mt-4 font-sans text-[13px] text-tomato">{err}</p> : null}
      <button onClick={save} disabled={busy} className="mt-6 rounded-xl px-6 py-3 font-sans text-[14px] font-medium text-[#F7F7F4] disabled:opacity-50" style={{ background: "var(--accent)" }}>
        {busy ? tr("invite.saving") : tr("invite.save")}
      </button>
    </main>
  );
}
