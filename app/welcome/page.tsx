"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { getMyProfile, MyProfile } from "@/lib/profile";
import { ROLES } from "@/lib/roles";

// First-run tour: confirm who you are → house rules → 60-second tour → first task.
export default function Welcome() {
  const router = useRouter();
  const [p, setP] = useState<MyProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getMyProfile().then((prof) => {
      if (!prof) { router.replace("/login"); return; }
      setP(prof); setName(prof.name || ""); setLoading(false);
    });
  }, [router]);

  async function patchProfile(fields: Record<string, any>) {
    if (!p) return;
    // Columns land with the 20260611 migration — never block the tour on a missing column
    try { await supabaseBrowser.from("profiles").update(fields).eq("id", p.id); } catch {}
  }

  if (loading || !p)
    return <main className="mx-auto max-w-xl px-6 py-12"><p className="font-serif text-2xl text-ink">One second…</p></main>;

  const world = ROLES[p.world];
  const firstTask = p.world === "office"
    ? { href: "/", label: "Read today's brief" }
    : { href: "/execute/handover", label: "Clock in on The Pass" };

  const steps = ["You", "House rules", "Your OS"];

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <p className="font-sans text-xs font-medium" style={{ color: "var(--accent)" }}>Welcome · step {step + 1} of {steps.length}</p>
      <div className="mt-3 flex items-center gap-2">
        {steps.map((_, k) => <span key={k} className={"h-1.5 rounded-full transition-all " + (k === step ? "w-8" : "w-1.5 bg-black/20")} style={k === step ? { background: "var(--accent)" } : undefined} />)}
      </div>

      {step === 0 ? (
        <>
          <h1 className="mt-6 font-serif text-4xl text-ink">This is you</h1>
          <p className="mt-3 font-serif text-[17px] leading-relaxed text-ink-soft">Check your name — it's how the team sees you in messages, the schedule and The Pass.</p>
          <label className="mt-6 block">
            <span className="font-mono text-[11px] uppercase tracking-wide text-clay">Your name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-xl border border-black/15 bg-transparent px-4 py-3 font-sans text-[15px] text-ink" />
          </label>
          <p className="mt-4 font-sans text-[14px] text-ink-soft">Role: <span className="text-ink">{p.dbRole}</span> · World: <span className="text-ink">{world.label}</span></p>
          <button
            onClick={async () => { setBusy(true); if (name.trim() && name.trim() !== p.name) await patchProfile({ name: name.trim() }); setBusy(false); setStep(1); }}
            disabled={busy}
            className="mt-8 rounded-xl px-6 py-3 font-sans text-[14px] font-medium text-[#F7F7F4] disabled:opacity-50" style={{ background: "var(--accent)" }}>
            That's me
          </button>
        </>
      ) : null}

      {step === 1 ? (
        <>
          <h1 className="mt-6 font-serif text-4xl text-ink">House rules</h1>
          <div className="mt-4 space-y-3 font-serif text-[16px] leading-relaxed text-ink-soft">
            <p>Your name, role, schedule and clock-ins live in the OS so the venue can run service, pay you correctly and meet its legal duties. Your data stays inside the company and is never sold. You can ask the office to see or correct it at any time (GDPR).</p>
            <p>Clock-in uses your phone's location only at the moment you clock in, only to confirm you're at the venue.</p>
            <p>No phones on the floor during service — the OS is for before and after. Allergen answers come from the Menu, never from memory.</p>
          </div>
          <button
            onClick={async () => { setBusy(true); await patchProfile({ gdpr_accepted_at: new Date().toISOString() }); setBusy(false); setStep(2); }}
            disabled={busy}
            className="mt-8 rounded-xl px-6 py-3 font-sans text-[14px] font-medium text-[#F7F7F4] disabled:opacity-50" style={{ background: "var(--accent)" }}>
            I understand + accept
          </button>
        </>
      ) : null}

      {step === 2 ? (
        <>
          <h1 className="mt-6 font-serif text-4xl text-ink">Your OS, in 60 seconds</h1>
          <p className="mt-3 font-serif text-[17px] leading-relaxed text-ink-soft">As {world.label}, your home has {world.points.length} places. That's all of it — the Chef button finds everything else.</p>
          <div className="mt-6 divide-y divide-line border-y border-line">
            {world.points.map((pt) => (
              <div key={pt.href} className="py-4">
                <p className="font-serif text-[19px] text-ink">{pt.label}</p>
                <p className="mt-0.5 font-sans text-[13px] text-ink-soft">{pt.blurb}</p>
              </div>
            ))}
          </div>
          <button
            onClick={async () => { setBusy(true); await patchProfile({ first_run_done_at: new Date().toISOString() }); setBusy(false); router.replace(firstTask.href); }}
            disabled={busy}
            className="mt-8 rounded-xl px-6 py-3 font-sans text-[14px] font-medium text-[#F7F7F4] disabled:opacity-50" style={{ background: "var(--accent)" }}>
            {busy ? "…" : "Finish → " + firstTask.label}
          </button>
          <p className="mt-4"><Link href="/" className="font-sans text-[13px] text-ink-soft">Skip to home</Link></p>
        </>
      ) : null}
    </main>
  );
}
