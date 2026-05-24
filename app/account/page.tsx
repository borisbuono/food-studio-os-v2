"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { ROLES, RoleKey } from "@/lib/roles";

const ENTITY_LABEL: Record<string, string> = { holdings: "Holdings", bistro_mondo: "Bistro Mondo", taller: "Taller" };

export default function Account() {
  const [email, setEmail] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [role, setRole] = useState("office");
  const [entity, setEntity] = useState("holdings");

  useEffect(() => {
    supabaseBrowser.auth.getSession().then(({ data }) => { setEmail(data.session?.user?.email ?? null); setReady(true); });
    setRole(localStorage.getItem("fs_role") || "office");
    setEntity(localStorage.getItem("fs_entity") || "holdings");
  }, []);

  const roleLabel = ROLES[role as RoleKey]?.label || role;

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/" className="font-sans text-sm text-ink-soft">← home</Link>
      <p className="mt-6 font-sans text-xs font-medium text-ember">Your profile</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">{email || "Not signed in"}</h1>

      <div className="mt-8 divide-y divide-black/10 border-y border-black/10">
        <div className="flex items-baseline justify-between py-3">
          <span className="font-sans text-[14px] text-ink-soft">Venue</span>
          <span className="font-mono text-[12px] text-ink">{ENTITY_LABEL[entity] || entity}</span>
        </div>
        <div className="flex items-baseline justify-between py-3">
          <span className="font-sans text-[14px] text-ink-soft">Role</span>
          <span className="font-mono text-[12px] text-ink">{roleLabel}</span>
        </div>
        <div className="flex items-baseline justify-between py-3">
          <span className="font-sans text-[14px] text-ink-soft">Sign-in</span>
          <span className="font-mono text-[12px] text-ink">{ready ? (email ? "signed in" : "magic link") : "…"}</span>
        </div>
      </div>

      <p className="mt-4 font-sans text-[13px] leading-relaxed text-ink-soft">Switch venue or role from the home screen. When sign-in is live, your profile sets these automatically.</p>

      <div className="mt-8">
        {email ? (
          <button onClick={() => supabaseBrowser.auth.signOut().then(() => setEmail(null))} className="rounded-xl border border-black/15 px-5 py-3 font-sans text-[14px] text-ink-soft transition hover:border-ember/40">Sign out</button>
        ) : (
          <Link href="/login" className="inline-block rounded-xl bg-ember px-6 py-3 font-sans text-[14px] font-medium text-[#FCEFE7]">Sign in</Link>
        )}
      </div>
    </main>
  );
}
