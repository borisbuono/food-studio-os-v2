"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { REQUIRED_ACKS, ROLE_LABEL, OnboardingRole } from "@/lib/team/onboarding";
import FabHidden from "@/components/FabHidden";

// Public route — the /team/join?token= landing page for a new hire.
//
// Flow:
//   1. Resolve invitation by token (anon SELECT, RLS-gated to live rows).
//   2. Show a warm, editorial welcome with the venue accent.
//   3. Collect: name (confirm), photo (optional), phone, emergency contact,
//      bank details (payroll), acknowledge handbook / food safety / GDPR.
//   4. Submit → magic-link sign-in (so a real auth.users row exists) → the
//      final finalise() step (invited invitations row → accepted; profile
//      binds to venue + role via existing sync_my_profile_from_invite RPC;
//      onboarding_steps get the first three keys marked done).
//
// The two-phase design (form → sign-in) mirrors the existing invite → magic
// link → welcome flow, so no new auth mechanism ships with this commit.

type Invitation = {
  id: string;
  invited_email: string;
  invited_name: string | null;
  invited_phone: string | null;
  role: OnboardingRole;
  restaurant_id: string | null;
  entity_code: string;
  starting_date: string | null;
  language: string;
  accepted_at: string | null;
};

export default function TeamJoin() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params?.get("token") || "";

  const [inv, setInv] = useState<Invitation | null>(null);
  const [venueName, setVenueName] = useState<string>("your venue");
  const [status, setStatus] = useState<"loading" | "ready" | "sent" | "bad_token" | "already">("loading");

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [dob, setDob] = useState("");
  const [emergency, setEmergency] = useState("");
  const [iban, setIban] = useState("");
  const [acks, setAcks] = useState<Record<string, boolean>>({ handbook_ack: false, food_safety_ack: false, gdpr_ack: false });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!token) { setStatus("bad_token"); return; }
    (async () => {
      const { data, error } = await supabaseBrowser
        .from("team_invitations")
        .select("id,invited_email,invited_name,invited_phone,role,restaurant_id,entity_code,starting_date,language,accepted_at")
        .eq("magic_link_token", token)
        .maybeSingle();
      if (error || !data) { setStatus("bad_token"); return; }
      setInv(data as Invitation);
      setName(data.invited_name || "");
      setPhone(data.invited_phone || "");
      if (data.accepted_at) { setStatus("already"); return; }
      if (data.restaurant_id) {
        const { data: v } = await supabaseBrowser.from("restaurants").select("name").eq("id", data.restaurant_id).maybeSingle();
        if (v?.name) setVenueName(v.name);
      }
      setStatus("ready");
    })();
  }, [token]);

  async function submit() {
    if (!inv) return;
    if (!acks.handbook_ack || !acks.food_safety_ack || !acks.gdpr_ack) { setErr("Please acknowledge all three documents to continue."); return; }
    if (!name.trim()) { setErr("Your name, please."); return; }
    setBusy(true); setErr(null);

    // Stash the collected data in a JSON blob keyed to the token so /welcome
    // can pick it up after magic-link sign-in and write it to profiles +
    // onboarding_documents. sessionStorage keeps it browser-local.
    try {
      sessionStorage.setItem("fs_join_" + token, JSON.stringify({
        name: name.trim(), phone: phone.trim(), dob: dob || null, emergency: emergency.trim() || null, iban: iban.trim() || null, acks,
      }));
    } catch {}

    // Fire the magic-link sign-in — the callback comes back to /auth/callback,
    // then /welcome. From there /welcome reads the stash + persists.
    const { error } = await supabaseBrowser.auth.signInWithOtp({
      email: inv.invited_email,
      options: {
        emailRedirectTo: window.location.origin + "/auth/callback",
        data: { invitation_token: token },
      },
    });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setStatus("sent");
  }

  // ---------- Loading / error states ----------
  if (status === "loading") return <main className="mx-auto max-w-xl lg:max-w-4xl px-6 py-16"><FabHidden /><p className="font-serif text-2xl text-ink">Checking your invitation...</p></main>;

  if (status === "bad_token") return (
    <main className="mx-auto max-w-xl lg:max-w-4xl px-6 py-16">
      <FabHidden />
      <p className="font-sans text-xs font-medium text-ink-soft">Invitation</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">This link is no longer live</h1>
      <p className="mt-3 font-serif text-[17px] leading-relaxed text-ink-soft">It may have expired, or the manager who sent it revoked it. Ask them for a fresh link.</p>
      <Link href="/login" className="mt-6 inline-block rounded-xl border border-black/15 px-5 py-3 font-sans text-[14px] text-ink">Already signed up? Sign in</Link>
    </main>
  );

  if (status === "already") return (
    <main className="mx-auto max-w-xl lg:max-w-4xl px-6 py-16">
      <FabHidden />
      <p className="font-sans text-xs font-medium text-ink-soft">Welcome back</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">You have already joined</h1>
      <p className="mt-3 font-serif text-[17px] leading-relaxed text-ink-soft">Nothing more to do here. Sign in whenever you are ready.</p>
      <Link href="/login" className="mt-6 inline-block rounded-xl px-5 py-3 font-sans text-[14px] font-medium text-[#F7F7F4]" style={{ background: "var(--accent)" }}>Go to sign in</Link>
    </main>
  );

  if (status === "sent") return (
    <main className="mx-auto max-w-xl lg:max-w-4xl px-6 py-16">
      <FabHidden />
      <p className="font-sans text-xs font-medium" style={{ color: "var(--accent)" }}>Check your email</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">One click away</h1>
      <p className="mt-3 font-serif text-[17px] leading-relaxed text-ink-soft">We just sent a sign-in link to {inv?.invited_email}. Open it from the same browser and you are in.</p>
    </main>
  );

  // ---------- The join form ----------
  if (!inv) return null;
  const first = (inv.invited_name || name).split(" ")[0] || "friend";

  return (
    <main className="mx-auto max-w-xl lg:max-w-4xl px-6 py-12">
      <FabHidden />
      <p className="font-sans text-xs font-medium" style={{ color: "var(--accent)" }}>Welcome</p>
      <h1 className="mt-2 font-serif text-4xl leading-[1.05] text-ink">Hello, {first}</h1>
      <p className="mt-3 font-serif text-[17px] leading-relaxed text-ink-soft">
        We are glad you are joining {venueName} as {ROLE_LABEL[inv.role]}. This is where you set your profile, acknowledge the house documents, and confirm your start.
      </p>

      <section className="mt-10">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Your profile</p>
        <div className="mt-3 space-y-4">
          <label className="block">
            <span className="font-mono text-[11px] uppercase tracking-wide text-clay">Full name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-xl border border-black/15 bg-transparent px-4 py-3 font-sans text-[15px] text-ink" />
          </label>
          <label className="block">
            <span className="font-mono text-[11px] uppercase tracking-wide text-clay">Phone</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-1 w-full rounded-xl border border-black/15 bg-transparent px-4 py-3 font-sans text-[15px] text-ink" placeholder="+34 ..." />
          </label>
          <label className="block">
            <span className="font-mono text-[11px] uppercase tracking-wide text-clay">Date of birth</span>
            <input type="date" value={dob} onChange={(e) => setDob(e.target.value)} className="mt-1 w-full rounded-xl border border-black/15 bg-transparent px-4 py-3 font-sans text-[15px] text-ink" />
          </label>
          <label className="block">
            <span className="font-mono text-[11px] uppercase tracking-wide text-clay">Emergency contact</span>
            <input value={emergency} onChange={(e) => setEmergency(e.target.value)} className="mt-1 w-full rounded-xl border border-black/15 bg-transparent px-4 py-3 font-sans text-[15px] text-ink" placeholder="Name and phone" />
          </label>
          <label className="block">
            <span className="font-mono text-[11px] uppercase tracking-wide text-clay">Bank IBAN (for payroll)</span>
            <input value={iban} onChange={(e) => setIban(e.target.value)} className="mt-1 w-full rounded-xl border border-black/15 bg-transparent px-4 py-3 font-sans text-[15px] text-ink font-mono" placeholder="ES..." />
            <span className="mt-1 block font-sans text-[12px] text-ink-soft">Stored encrypted. Never shown outside payroll.</span>
          </label>
        </div>
      </section>

      <section className="mt-10">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Sign the house documents</p>
        <div className="mt-3 divide-y divide-line border-y border-line">
          {REQUIRED_ACKS.map((ack) => (
            <label key={ack.key} className="flex cursor-pointer items-start gap-3 py-4">
              <input type="checkbox" checked={!!acks[ack.key]} onChange={(e) => setAcks({ ...acks, [ack.key]: e.target.checked })} className="mt-1 h-4 w-4" />
              <div>
                <p className="font-serif text-[17px] text-ink">{ack.label}</p>
                <p className="mt-0.5 font-sans text-[13px] text-ink-soft">{ack.blurb}</p>
                <button type="button" onClick={() => window.open("/handbook/" + ack.key, "_blank")} className="mt-1 font-mono text-[11px] uppercase tracking-wide" style={{ color: "var(--accent)" }}>Read →</button>
              </div>
            </label>
          ))}
        </div>
      </section>

      <section className="mt-10 border-t border-line pt-6">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Confirm your start</p>
        <p className="mt-2 font-serif text-[17px] text-ink">{inv.starting_date ? new Date(inv.starting_date + "T00:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }) : "Start date to be confirmed"}</p>
      </section>

      {err ? <p className="mt-4 font-sans text-[13px] text-tomato">{err}</p> : null}

      <button onClick={submit} disabled={busy} className="mt-8 w-full rounded-xl px-6 py-4 font-sans text-[15px] font-medium text-[#F7F7F4] disabled:opacity-50" style={{ background: "var(--accent)" }}>
        {busy ? "One moment..." : "Join the team"}
      </button>
      <p className="mt-4 font-sans text-[12px] text-ink-soft">By joining you agree we can email you your sign-in link. Nothing to remember — just your email.</p>
    </main>
  );
}
