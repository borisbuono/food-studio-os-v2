"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { ONBOARDING_ROLES, ROLE_LABEL, ROLE_BLURB, RESTAURANT_TO_ENTITY_CODE, joinUrl, OnboardingRole } from "@/lib/team/onboarding";

// The three-step "invite a new hire" wizard. Writes a team_invitations row +
// generates a magic-link URL the manager can hand off via WhatsApp / email.
//
// Structure — three tabs, editorial one-column layout, no emoji:
//   1. Role + venue + start date            (what the job is)
//   2. Contact — name / email / phone       (who they are)
//   3. Preview — the copy that goes out     (send it)
//
// The magic-link URL is built off window.location.origin so it works on
// staging + production without config. Server-side, /team/join reads by token.

type Venue = { id: string; name: string };

export default function OnboardNew() {
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [venueId, setVenueId] = useState("");
  const [role, setRole] = useState<OnboardingRole>("foh");
  const [startingDate, setStartingDate] = useState<string>("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [lang, setLang] = useState<"es" | "en">("es");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState<null | { token: string; url: string }>(null);

  useEffect(() => {
    supabaseBrowser.from("restaurants").select("id,name").then(({ data }) => {
      const v = data || [];
      setVenues(v);
      if (v[0] && !venueId) setVenueId(v[0].id);
    });
    // Default the start date to next Monday — the shape of a hospitality hire.
    const now = new Date();
    const daysUntilMonday = (8 - now.getDay()) % 7 || 7;
    const monday = new Date(now); monday.setDate(now.getDate() + daysUntilMonday);
    setStartingDate(monday.toISOString().slice(0, 10));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const entityCode = useMemo(() => RESTAURANT_TO_ENTITY_CODE[venueId] || "IFL", [venueId]);
  const venueName = useMemo(() => venues.find((v) => v.id === venueId)?.name || "your venue", [venues, venueId]);

  const first = name.split(" ")[0] || "";
  const inviteMsg = lang === "es"
    ? `Hola ${first}! Te damos la bienvenida a ${venueName}. Abre este enlace desde tu movil para completar tu perfil, firmar los documentos y ver tu formacion.`
    : `Hi ${first}! Welcome to ${venueName}. Open this link on your phone to complete your profile, sign the documents and see your training path.`;

  async function submit() {
    setErr(null);
    if (!name.trim() || !email.trim()) { setErr("Name and email are required."); return; }
    setBusy(true);
    const { data: u } = await supabaseBrowser.auth.getUser();
    const { data, error } = await supabaseBrowser.from("team_invitations").insert({
      entity_code: entityCode,
      restaurant_id: venueId || null,
      invited_email: email.trim().toLowerCase(),
      invited_name: name.trim(),
      invited_phone: phone.trim() || null,
      invited_by_user_id: u.user?.id || null,
      role,
      starting_date: startingDate || null,
      language: lang,
    }).select("magic_link_token").maybeSingle();
    setBusy(false);
    if (error || !data) {
      setErr(error?.message?.includes("row-level security")
        ? "Sign in as a manager to send invitations."
        : (error?.message || "Couldn't save."));
      return;
    }
    setSent({ token: data.magic_link_token, url: joinUrl(window.location.origin, data.magic_link_token) });
  }

  // ---------- Sent screen ----------
  if (sent) {
    return (
      <main className="mx-auto max-w-xl px-6 py-12">
        <Link href="/administrate/team/onboarding" className="font-sans text-sm text-ink-soft">back to onboarding</Link>
        <p className="mt-6 font-sans text-xs font-medium" style={{ color: "var(--accent)" }}>Invitation ready</p>
        <h1 className="mt-2 font-serif text-3xl text-ink">{name} is invited</h1>
        <p className="mt-3 font-serif text-[17px] leading-relaxed text-ink-soft">Send this link — it opens the join page on their phone. It stays live for 30 days.</p>

        <div className="mt-6 rounded-2xl border border-line bg-card p-5">
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Magic link</p>
          <p className="mt-1 break-all font-mono text-[12px] text-ink">{sent.url}</p>
          <button onClick={() => { navigator.clipboard.writeText(sent.url); }} className="mt-3 rounded-xl border border-black/15 px-4 py-2 font-sans text-[13px] text-ink transition hover:border-black/30">Copy link</button>
        </div>

        <div className="mt-6 border-y border-line py-5">
          <p className="font-sans text-[14px] leading-relaxed text-ink">{inviteMsg}</p>
          <p className="mt-3 font-mono text-[11px] text-ink-soft">{sent.url}</p>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          {phone ? (
            <a href={"https://wa.me/" + phone.replace(/[^\d]/g, "") + "?text=" + encodeURIComponent(inviteMsg + "\n" + sent.url)} className="rounded-xl px-5 py-3 font-sans text-[14px] font-medium text-[#F7F7F4]" style={{ background: "var(--accent)" }}>Send via WhatsApp</a>
          ) : null}
          <a href={"mailto:" + email + "?subject=" + encodeURIComponent("Welcome to " + venueName) + "&body=" + encodeURIComponent(inviteMsg + "\n\n" + sent.url)} className="rounded-xl border border-black/15 px-5 py-3 font-sans text-[14px] text-ink">Send via email</a>
          <Link href="/administrate/team/onboard/new" className="px-2 py-3 font-sans text-[14px] text-ink-soft" onClick={() => { setSent(null); setStep(0); setName(""); setEmail(""); setPhone(""); }}>Invite another</Link>
        </div>
      </main>
    );
  }

  // ---------- Wizard steps ----------
  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/administrate/team/onboarding" className="font-sans text-sm text-ink-soft">back to onboarding</Link>
      <p className="mt-6 font-sans text-xs font-medium" style={{ color: "var(--accent)" }}>Onboarding a new hire · step {step + 1} of 3</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">{step === 0 ? "The role" : step === 1 ? "Their details" : "Ready to send"}</h1>

      <div className="mt-4 flex items-center gap-2">
        {[0, 1, 2].map((k) => <span key={k} className={"h-1.5 rounded-full transition-all " + (k === step ? "w-8" : "w-1.5 bg-black/20")} style={k === step ? { background: "var(--accent)" } : undefined} />)}
      </div>

      {step === 0 ? (
        <section className="mt-8 space-y-5">
          <label className="block">
            <span className="font-mono text-[11px] uppercase tracking-wide text-clay">Venue</span>
            <select value={venueId} onChange={(e) => setVenueId(e.target.value)} className="mt-1 w-full rounded-xl border border-black/15 bg-transparent px-4 py-3 font-sans text-[15px] text-ink">
              {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              {!venues.length ? <option>No venues yet — add one first</option> : null}
            </select>
          </label>

          <div className="block">
            <span className="font-mono text-[11px] uppercase tracking-wide text-clay">Role</span>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {ONBOARDING_ROLES.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRole(r)}
                  className={"rounded-xl border px-3 py-2.5 text-left transition " + (role === r ? "border-ink" : "border-black/15 hover:border-black/30")}
                >
                  <p className="font-sans text-[14px] text-ink">{ROLE_LABEL[r]}</p>
                  <p className="mt-0.5 font-sans text-[11px] text-ink-soft">{ROLE_BLURB[r]}</p>
                </button>
              ))}
            </div>
          </div>

          <label className="block">
            <span className="font-mono text-[11px] uppercase tracking-wide text-clay">Starting date</span>
            <input type="date" value={startingDate} onChange={(e) => setStartingDate(e.target.value)} className="mt-1 w-full rounded-xl border border-black/15 bg-transparent px-4 py-3 font-sans text-[15px] text-ink" />
          </label>

          <div className="pt-2 flex justify-end">
            <button onClick={() => setStep(1)} className="rounded-xl px-6 py-3 font-sans text-[14px] font-medium text-[#F7F7F4]" style={{ background: "var(--accent)" }}>Next</button>
          </div>
        </section>
      ) : null}

      {step === 1 ? (
        <section className="mt-8 space-y-5">
          <label className="block">
            <span className="font-mono text-[11px] uppercase tracking-wide text-clay">Full name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-xl border border-black/15 bg-transparent px-4 py-3 font-sans text-[15px] text-ink" placeholder="First and last name" />
          </label>
          <label className="block">
            <span className="font-mono text-[11px] uppercase tracking-wide text-clay">Email</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full rounded-xl border border-black/15 bg-transparent px-4 py-3 font-sans text-[15px] text-ink" placeholder="name@example.com" />
          </label>
          <label className="block">
            <span className="font-mono text-[11px] uppercase tracking-wide text-clay">Phone (optional)</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-1 w-full rounded-xl border border-black/15 bg-transparent px-4 py-3 font-sans text-[15px] text-ink" placeholder="+34 ..." />
            <span className="mt-1 block font-sans text-[12px] text-ink-soft">Adding a phone unlocks the WhatsApp send option.</span>
          </label>
          <label className="block">
            <span className="font-mono text-[11px] uppercase tracking-wide text-clay">Their language</span>
            <select value={lang} onChange={(e) => setLang(e.target.value as "es" | "en")} className="mt-1 w-full rounded-xl border border-black/15 bg-transparent px-4 py-3 font-sans text-[15px] text-ink">
              <option value="es">Espanol</option>
              <option value="en">English</option>
            </select>
          </label>

          <div className="pt-2 flex justify-between">
            <button onClick={() => setStep(0)} className="rounded-xl border border-black/15 px-5 py-3 font-sans text-[14px] text-ink-soft">Back</button>
            <button onClick={() => setStep(2)} className="rounded-xl px-6 py-3 font-sans text-[14px] font-medium text-[#F7F7F4]" style={{ background: "var(--accent)" }}>Preview</button>
          </div>
        </section>
      ) : null}

      {step === 2 ? (
        <section className="mt-8">
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">What they will see</p>
          <div className="mt-3 rounded-2xl border border-line bg-card p-5">
            <p className="font-serif italic text-[15px] text-ink-soft">Welcome, {name || "friend"}</p>
            <h2 className="mt-1 font-serif text-2xl text-ink">Set up your profile</h2>
            <p className="mt-2 font-sans text-[14px] text-ink-soft">
              A short form, three documents to sign, then the OS is theirs. Starting {startingDate || "TBD"} at {venueName} as {ROLE_LABEL[role]}.
            </p>
          </div>

          <div className="mt-6 border-t border-b border-line py-4">
            <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Message they get</p>
            <p className="mt-2 font-sans text-[14px] leading-relaxed text-ink">{inviteMsg}</p>
          </div>

          {err ? <p className="mt-4 font-sans text-[13px] text-tomato">{err}</p> : null}

          <div className="mt-6 flex justify-between">
            <button onClick={() => setStep(1)} className="rounded-xl border border-black/15 px-5 py-3 font-sans text-[14px] text-ink-soft">Back</button>
            <button onClick={submit} disabled={busy} className="rounded-xl px-6 py-3 font-sans text-[14px] font-medium text-[#F7F7F4] disabled:opacity-50" style={{ background: "var(--accent)" }}>
              {busy ? "Sending..." : "Send invitation"}
            </button>
          </div>
        </section>
      ) : null}
    </main>
  );
}
