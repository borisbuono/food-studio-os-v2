"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { ROLES, RoleKey } from "@/lib/roles";
import { ENTITY_ACCENT, EntityKey } from "@/lib/entities";

const ENTITY_LABEL: Record<string, string> = { holdings: "Holdings", bistro_mondo: "Bistro Mondo", taller: "Taller", utopia: "Restaurant Utopia" };
const SWATCHES = [
  { name: "Teal", hex: "#0E7C86" }, { name: "Blue", hex: "#2563EB" }, { name: "Coral", hex: "#E2603F" },
  { name: "Plum", hex: "#7A4E8C" }, { name: "Forest", hex: "#3E5A37" }, { name: "Amber", hex: "#B5701C" }, { name: "Ink", hex: "#2B3A45" },
];

export default function Account() {
  const [email, setEmail] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [role, setRole] = useState("office");
  const [entity, setEntity] = useState("holdings");
  const [userAccent, setUserAccent] = useState<string | null>(null);

  useEffect(() => {
    supabaseBrowser.auth.getSession().then(({ data }) => { setEmail(data.session?.user?.email ?? null); setReady(true); });
    setRole(localStorage.getItem("fs_role") || "office");
    setEntity(localStorage.getItem("fs_entity") || "holdings");
    setUserAccent(localStorage.getItem("fs_user_accent"));
  }, []);

  const pick = (hex: string) => { localStorage.setItem("fs_user_accent", hex); document.documentElement.style.setProperty("--accent", hex); setUserAccent(hex); };
  const reset = () => { localStorage.removeItem("fs_user_accent"); document.documentElement.style.setProperty("--accent", ENTITY_ACCENT[entity as EntityKey] || "#B8552E"); setUserAccent(null); };
  const roleLabel = ROLES[role as RoleKey]?.label || role;

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/" className="font-sans text-sm text-ink-soft">← home</Link>
      <p className="mt-6 font-sans text-xs font-medium" style={{ color: "var(--accent)" }}>Your profile</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">{email || "Not signed in"}</h1>

      <div className="mt-8 divide-y divide-black/10 border-y border-black/10">
        <div className="flex items-baseline justify-between py-3"><span className="font-sans text-[14px] text-ink-soft">Venue</span><span className="font-mono text-[12px] text-ink">{ENTITY_LABEL[entity] || entity}</span></div>
        <div className="flex items-baseline justify-between py-3"><span className="font-sans text-[14px] text-ink-soft">Role</span><span className="font-mono text-[12px] text-ink">{roleLabel}</span></div>
        <div className="flex items-baseline justify-between py-3"><span className="font-sans text-[14px] text-ink-soft">Sign-in</span><span className="font-mono text-[12px] text-ink">{ready ? (email ? "signed in" : "magic link") : "…"}</span></div>
      </div>

      <p className="mt-8 font-sans text-xs font-medium" style={{ color: "var(--accent)" }}>Your colour</p>
      <p className="mt-1 font-sans text-[13px] leading-relaxed text-ink-soft">Make it yours — this sets your accent across the whole app. (Background, brand and Instagram feed personalisation coming next.)</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {SWATCHES.map((s) => (
          <button key={s.hex} onClick={() => pick(s.hex)} title={s.name} aria-label={s.name} style={{ background: s.hex }} className={"h-9 w-9 rounded-full transition " + (userAccent === s.hex ? "ring-2 ring-ink ring-offset-2 ring-offset-paper" : "hover:scale-110")} />
        ))}
        <button onClick={reset} className="rounded-full border border-black/15 px-3 py-2 font-mono text-[10px] uppercase tracking-wide text-ink-soft transition hover:border-ink/40">Venue colour</button>
      </div>

      <div className="mt-10">
        {email ? (
          <button onClick={() => supabaseBrowser.auth.signOut().then(() => setEmail(null))} className="rounded-xl border border-black/15 px-5 py-3 font-sans text-[14px] text-ink-soft transition hover:border-ember/40">Sign out</button>
        ) : (
          <Link href="/login" className="inline-block rounded-xl px-6 py-3 font-sans text-[14px] font-medium text-[#FCEFE7]" style={{ background: "var(--accent)" }}>Sign in</Link>
        )}
      </div>
    </main>
  );
}
