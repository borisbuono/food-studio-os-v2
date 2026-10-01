"use client";
import { useEffect, useState } from "react";
import { getLang, t, type Lang } from "@/lib/i18n";
import { inviteTeammate, inviteMessage, SHEET_ROLES, SHEET_ROLE_LABEL, type SheetRole } from "@/lib/team/inviteClient";

type Venue = { id: string; name: string };

// "+ Add to team" card on the Team tab. Same flow as the Invite tab
// (lib/team/inviteClient.ts → POST /api/team/invite → accept link); before
// 2026-10-02 this inserted a bare team_members row that RLS refused and that
// never produced a membership. `venues` are HOUSES (entities), not restaurants.
export default function InviteTeammate({ venues }: { venues: Venue[] }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<SheetRole>("cook");
  const [venueId, setVenueId] = useState(venues[0]?.id ?? "");
  const [lang, setLang] = useState<"es" | "en">("es");
  const [ui, setUi] = useState<Lang>("en");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; url?: string } | null>(null);
  useEffect(() => { setUi(getLang()); }, []);
  const tr = (k: string) => t(k, ui);

  async function submit() {
    if (!name.trim() || !email.trim()) { setMsg({ ok: false, text: tr("invite.err.required") }); return; }
    if (!venueId) { setMsg({ ok: false, text: tr("invite.err.house") }); return; }
    setBusy(true); setMsg(null);
    const r = await inviteTeammate({ entity_id: venueId, name, email, phone, role, language: lang });
    setBusy(false);
    if (!r.ok) { setMsg({ ok: false, text: r.status === 403 ? tr("invite.err.rls") : r.error }); return; }
    const houseName = venues.find((v) => v.id === venueId)?.name;
    setMsg({ ok: true, text: inviteMessage(name, email.trim().toLowerCase(), r.accept_url, lang, houseName), url: r.accept_url });
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mt-6 w-full rounded-2xl border border-dashed border-line py-3 font-sans text-[14px] text-ink-soft transition hover:border-ink-soft">
        {tr("invite.add")}
      </button>
    );
  }

  const field = "w-full rounded-xl border border-black/15 bg-paper px-3 py-2.5 font-sans text-[14px] text-ink";
  const waHref = phone ? "https://wa.me/" + phone.replace(/[^\d]/g, "") + "?text=" + encodeURIComponent(msg?.text || "") : null;
  return (
    <div className="mt-6 rounded-2xl border border-line bg-card p-5">
      <p className="font-sans text-xs font-medium text-ink-soft">{tr("invite.title")}</p>
      {msg?.ok ? (
        <div className="mt-3">
          <p className="font-sans text-[14px] leading-relaxed text-ink break-words">{msg.text}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {waHref ? <a href={waHref} className="rounded-xl bg-[color:var(--accent)] px-4 py-2 font-sans text-[13px] font-medium text-[#F7F7F4]">{tr("invite.wa")}</a> : null}
            <a href={"mailto:" + email + "?subject=" + encodeURIComponent(tr("invite.mail.subject")) + "&body=" + encodeURIComponent(msg.text)} className="rounded-xl border border-black/15 px-4 py-2 font-sans text-[13px] text-ink">{tr("invite.mail")}</a>
            <button type="button" onClick={() => { if (msg.url) navigator.clipboard?.writeText(msg.url).catch(() => {}); }} className="rounded-xl border border-black/15 px-4 py-2 font-sans text-[13px] text-ink">{tr("invite.copy")}</button>
            <button type="button" onClick={() => { setMsg(null); setName(""); setEmail(""); setPhone(""); }} className="px-2 py-2 font-sans text-[13px] text-ink-soft">{tr("invite.another")}</button>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-3 space-y-2.5">
            <input className={field} placeholder={tr("invite.name.ph")} value={name} onChange={(e) => setName(e.target.value)} />
            <input className={field} placeholder="name@example.com" type="email" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} />
            <input className={field} placeholder="+34 …" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            <div className="grid grid-cols-2 gap-2.5">
              <select className={field} value={role} onChange={(e) => setRole(e.target.value as SheetRole)}>
                {SHEET_ROLES.map((r) => <option key={r} value={r}>{SHEET_ROLE_LABEL[r][ui]}</option>)}
              </select>
              <select className={field} value={lang} onChange={(e) => setLang(e.target.value === "en" ? "en" : "es")}>
                <option value="es">Español</option>
                <option value="en">English</option>
              </select>
              {venues.length > 1 ? (
                <select className={field} value={venueId} onChange={(e) => setVenueId(e.target.value)}>
                  {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              ) : null}
            </div>
          </div>
          {msg ? <p className="mt-3 font-sans text-[13px] text-clay">{msg.text}</p> : null}
          <div className="mt-4 flex gap-3">
            <button onClick={submit} disabled={busy} className="rounded-xl bg-[color:var(--accent)] px-5 py-2.5 font-sans text-[14px] font-medium text-[#F7F7F4] disabled:opacity-50">
              {busy ? tr("invite.saving") : tr("invite.send")}
            </button>
            <button onClick={() => { setOpen(false); setMsg(null); }} className="rounded-xl border border-black/15 px-5 py-2.5 font-sans text-[14px] text-ink-soft">{tr("invite.cancel")}</button>
          </div>
        </>
      )}
    </div>
  );
}
