"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getMyProfile } from "@/lib/profile";
import { OFFICE_ONLY_PREFIXES } from "@/lib/roles";

// Defence-in-depth at the UX layer: a signed-in non-admin can't open Office-only
// routes (Administrate). Signed-out users stay in preview (staging). The hard
// boundary is DB RLS — surfaced separately for per-table lockdown before launch.
export default function RouteGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [blocked, setBlocked] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let live = true;
    const officeOnly = OFFICE_ONLY_PREFIXES.some((p) => pathname?.startsWith(p));
    if (!officeOnly) { setBlocked(false); setChecked(true); return; }
    getMyProfile().then((p) => {
      if (!live) return;
      // only enforce for signed-in non-admins; preview (no profile) is left open on staging
      const deny = !!p && !p.isAdmin;
      setBlocked(deny); setChecked(true);
    });
    return () => { live = false; };
  }, [pathname]);

  if (checked && blocked) {
    return (
      <main className="mx-auto max-w-xl px-6 py-16">
        <p className="font-sans text-xs font-medium" style={{ color: "var(--accent)" }}>Not in your area</p>
        <h1 className="mt-2 font-serif text-3xl text-ink">That’s an Office screen</h1>
        <p className="mt-3 font-serif text-[17px] leading-relaxed text-ink-soft">Your role doesn’t include the back-office. Everything you need is on your home and in Ask.</p>
        <button onClick={() => router.replace("/")} className="mt-6 rounded-xl px-5 py-3 font-sans text-[14px] font-medium text-[#F7F7F4]" style={{ background: "var(--accent)" }}>Back to home</button>
      </main>
    );
  }
  return <>{children}</>;
}
