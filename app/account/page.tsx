"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { ROLES, RoleKey, mapDbRole } from "@/lib/roles";
import { ENTITY_ACCENT, ENTITY_LABEL, EntityKey } from "@/lib/entities";
import { getMyProfile, MyProfile } from "@/lib/profile";

const SWATCHES = [
  { name: "Teal", hex: "#0E7C86" }, { name: "Blue", hex: "#2563EB" }, { name: "Coral", hex: "#E2603F" },
  { name: "Plum", hex: "#7A4E8C" }, { name: "Forest", hex: "#3E5A37" }, { name: "Amber", hex: "#B5701C" }, { name: "Ink", hex: "#2B3A45" },
];

export default function Account() {
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [ready, setReady] = useState(false);
  const [userAccent, setUserAccent] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getMyProfile().then((p) => { setProfile(p); setReady(true); });
    setUserAccent(localStorage.getItem("fs_user_accent"));
  }, []);

  const entity: EntityKey = profile?.entity || "holdings";
  const venueLabel = profile?.entity ? ENTITY_LABEL[profile.entity] : (profile && !profile.isAdmin ? "Not assigned yet" : "All venues");
  const roleLabel = profile ? ROLES[mapDbRole(profile.dbRole).world as RoleKey].label : "—";

  const pick = async (hex: string) => {
    localStorage.setItem("fs_user_accent", hex);
    document.documentElement.style.setProperty("--accent", hex);
    setUserAccent(hex);
    // persist to the profile (color is a self-updatable column)
    if (profile) { setSaving(true); try { await supabaseBrowser.from("profiles").update({ color: hex }).eq("id", profile.id); } catch {} setSaving(false); }
  };
  const reset = async () => {
    localStorage.removeItem("fs_user_accent");
    document.documentElement.style.setProperty("--accent", ENTITY_ACCENT[entity] || "#B8552E");
    setUserAccent(null);
    if (profile) { setSaving(true); try { await supabaseBrowser.from("profiles").update({ color: null }).eq("id", profile.id); } catch {} setSaving(false); }
  };

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/" className="font-sans text-sm text-ink-soft">← home</Link>
      <p className="mt-6 font-sans text-xs font-medium" style={{ color: "var(--accent)" }}>Your profile</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">{profile?.name || profile?.email || "Not signed in"}</h1>

      <div className="mt-8 divide-y divide-black/10 border-y border-black/10">
        <div className="flex items-baseline justify-between py-3"><span className="font-sans text-[14px] text-ink-soft">Venue</span><span className="font-mono text-[12px] text-ink">{venueLabel}</span></div>
        <div className="flex items-baseline justify-between py-3"><span className="font-sans text-[14px] text-ink-soft">Role</span><span className="font-mono text-[12px] text-ink">{roleLabel}{profile?.isAdmin ? " · admin" : ""}</span></div>
        <div className="flex items-baseline justify-between py-3"><span className="font-sans text-[14px] text-ink-soft">Sign-in</span><span className="font-mono text-[12px] text-ink">{ready ? (profile ? "signed in" : "signed out") : "…"}</span></div>
      </div>

      <div className="mt-6">
        <Link href="/academy" className="font-sans text-sm text-ember">Your academy →</Link>
      </div>

      <p className="mt-8 font-sans text-xs font-medium" style={{ color: "var(--accent)" }}>Your colour</p>
      <p className="mt-1 font-sans text-[13px] leading-relaxed text-ink-soft">Make it yours — this sets your accent across the whole app{profile ? " and is saved to your profile" : ""}. (Background, brand and Instagram feed personalisation coming next.)</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {SWATCHES.map((sw) => (
          <button key={sw.hex} onClick={() => pick(sw.hex)} title={sw.name} aria-label={sw.name} style={{ background: sw.hex }} className={"h-9 w-9 rounded-full transition " + (userAccent === sw.hex ? "ring-2 ring-ink ring-offset-2 ring-offset-paper" : "hover:scale-110")} />
        ))}
        <button onClick={reset} className="rounded-full border border-black/15 px-3 py-2 font-mono text-[10px] uppercase tracking-wide text-ink-soft transition hover:border-ink/40">Venue colour</button>
        {saving ? <span className="font-mono text-[10px] text-clay">saving…</span> : null}
      </div>

      <div className="mt-10">
        {profile ? (
          <button onClick={() => supabaseBrowser.auth.signOut().then(() => setProfile(null))} className="rounded-xl border border-black/15 px-5 py-3 font-sans text-[14px] text-ink-soft transition hover:border-ember/40">Sign out</button>
        ) : (
          <Link href="/login" className="inline-block rounded-xl px-6 py-3 font-sans text-[14px] font-medium text-[#FCEFE7]" style={{ background: "var(--accent)" }}>Sign in</Link>
        )}
      </div>
    </main>
  );
}
