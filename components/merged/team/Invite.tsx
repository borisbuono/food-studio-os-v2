"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { t, getLang, Lang } from "@/lib/i18n";
import { inviteTeammate, invitableHouses, inviteMessage, SHEET_ROLES, SHEET_ROLE_LABEL, type SheetRole } from "@/lib/team/inviteClient";

// Team › Invite tab (folded into /h/<slug>/team?tab=invite, slim OS slice 4).
//
// 2026-10-02 (cook path): ONE flow — lib/team/inviteClient.ts → POST
// /api/team/invite → pending_invites + roster row → the invitee opens the
// accept link → accept_pending_invite() → memberships row → /h/<slug>.
// The old browser-side team_members insert (RLS-refused, no membership) is gone.
// Roles: Cook · Front of house · Manager. The message carries the ACCEPT link.
export default function InviteToTeam({ houseId }: { houseId?: string | null }) {
  const [houses, setHouses] = useState<{ id: string; name: string }[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<SheetRole>("cook");
  const [venue, setVenue] = useState(houseId || "");
  const [lang, setLang] = useState<"es" | "en">("es");   // invitee's language (saved on the invite)
  const [ui, setUi] = useState<Lang>("en");              // manager's UI language (fs_lang cookie)
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ accept_url: string; emailed: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const tr = (key: string) => t(key, ui);

  useEffect(() => {
    setUi(getLang());
    invitableHouses().then((v) => {
      setHouses(v);
      if (!venue && v[0]) setVenue(v[0].id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    setErr(null);
    if (!name.trim() || !email.trim()) { setErr(tr("invite.err.required")); return; }
    if (!venue) { setErr(tr("invite.err.house")); return; }
    setBusy(true);
    const r = await inviteTeammate({ entity_id: venue, name, email, phone, role, language: lang });
    setBusy(false);
    if (!r.ok) { setErr(r.status === 403 ? tr("invite.err.rls") : r.error); return; }
    setDone({ accept_url: r.accept_url, emailed: r.emailed });
  }

  const houseName = houses.find((h) => h.id === venue)?.name;
  const msg = done ? inviteMessage(name, email.trim().toLowerCase(), done.accept_url, lang, houseName) : "";
  const back = houseId ? undefined : "/studio/people";

  if (done)
    return (
      <main className="mx-auto max-w-xl lg:max-w-4xl px-6 py-6">
        {back ? <Link href={back} className="font-sans text-sm text-ink-soft">{tr("invite.back")}</Link> : null}
        <p className="mt-6 font-sans text-xs font-medium" style={{ color: "var(--accent)" }}>{tr("invite.saved")}</p>
        <h1 className="mt-2 font-serif text-3xl text-ink">{t("invite.saved.title", ui).replace("{name}", name)}</h1>
        <p className="mt-3 font-serif text-[17px] leading-relaxed text-ink-soft">
          {tr("invite.saved.body.a")} <span className="font-medium text-ink">{email}</span>{tr("invite.saved.body.b")}
          {done.emailed ? <span> {tr("invite.saved.emailed")}</span> : null}
        </p>
        <div className="mt-6 border-y border-line py-4">
          <p className="font-sans text-[14px] leading-relaxed text-ink break-words">{msg}</p>
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          {phone ? (
            <a href={"https://wa.me/" + phone.replace(/[^\d]/g, "") + "?text=" + encodeURIComponent(msg)} className="rounded-xl px-5 py-3 font-sans text-[14px] font-medium text-[#F7F7F4]" style={{ background: "var(--accent)" }}>{tr("invite.wa")}</a>
          ) : null}
          <a href={"mailto:" + email + "?subject=" + encodeURIComponent(tr("invite.mail.subject")) + "&body=" + encodeURIComponent(msg)} className="rounded-xl border border-black/15 px-5 py-3 font-sans text-[14px] text-ink">{tr("invite.mail")}</a>
          <button type="button" onClick={() => { navigator.clipboard?.writeText(done.accept_url).catch(() => {}); }} className="rounded-xl border border-black/15 px-5 py-3 font-sans text-[14px] text-ink">{tr("invite.copy")}</button>
          <button onClick={() => { setDone(null); setName(""); setEmail(""); setPhone(""); }} className="px-2 py-3 font-sans text-[14px] text-ink-soft">{tr("invite.another")}</button>
        </div>
      </main>
    );

  return (
    <main className="mx-auto max-w-xl lg:max-w-4xl px-6 py-6">
      {back ? <Link href={back} className="font-sans text-sm text-ink-soft">{tr("invite.back")}</Link> : null}
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
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoCapitalize="none" className="mt-1 w-full rounded-xl border border-black/15 bg-transparent px-4 py-3 font-sans text-[15px] text-ink" placeholder="name@example.com" />
        </label>
        <label className="block">
          <span className="font-mono text-[11px] uppercase tracking-wide text-clay">{tr("invite.phone")}</span>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" className="mt-1 w-full rounded-xl border border-black/15 bg-transparent px-4 py-3 font-sans text-[15px] text-ink" placeholder="+34 …" />
        </label>
        <div className="flex gap-4">
          <label className="block flex-1">
            <span className="font-mono text-[11px] uppercase tracking-wide text-clay">{tr("invite.role")}</span>
            <select value={role} onChange={(e) => setRole(e.target.value as SheetRole)} className="mt-1 w-full rounded-xl border border-black/15 bg-transparent px-4 py-3 font-sans text-[15px] text-ink">
              {SHEET_ROLES.map((r) => <option key={r} value={r}>{SHEET_ROLE_LABEL[r][ui]}</option>)}
            </select>
          </label>
          {!houseId ? (
            <label className="block flex-1">
              <span className="font-mono text-[11px] uppercase tracking-wide text-clay">{tr("invite.venue")}</span>
              <select value={venue} onChange={(e) => setVenue(e.target.value)} className="mt-1 w-full rounded-xl border border-black/15 bg-transparent px-4 py-3 font-sans text-[15px] text-ink">
                {houses.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </label>
          ) : null}
        </div>
        <label className="block">
          <span className="font-mono text-[11px] uppercase tracking-wide text-clay">{tr("invite.lang")}</span>
          <select value={lang} onChange={(e) => setLang(e.target.value === "en" ? "en" : "es")} className="mt-1 w-full rounded-xl border border-black/15 bg-transparent px-4 py-3 font-sans text-[15px] text-ink">
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
