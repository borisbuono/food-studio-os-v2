"use client";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import DesktopSidebar from "@/components/DesktopSidebar";
import TopBar from "@/components/TopBar";
import BrandMark from "@/components/BrandMark";
import RoomSwitcher from "@/components/RoomSwitcher";
import AuthStatus from "@/components/AuthStatus";
import { getMyProfile, MyProfile } from "@/lib/profile";

// Chrome (sidebar + topbar) that hides on public/unauth routes so /welcome
// and /login render as a marketing shell, not the entity-scoped app shell.
// Boris asked (2026-08-19): "logging in on top of Bistro Mondo... it needs
// a front page for Food Studio OS."
//
// Push 1 (2026-08-23) — three shell modes:
//   • public   → children only (welcome, login, /m/*, /auth/*)
//   • slim     → single-role user: hide sidebar entirely, slim top bar
//                  (entity + user chip). Room switcher NOT shown (there's
//                  only one room for this user).
//   • full     → owner or multi-role user: sidebar + topbar + room switcher.
//
// Push (2026-08-31, Boris walk 09:50 CET) — the redundant top-right identity
// chip is GONE. The bottom-left chip in DesktopSidebar carries the sign-out
// menu and is the useful one. Having two chips reading "Boris Buono" on the
// same page was noise. The RoomSwitcher renders itself scope-aware now
// (studio → hidden, house/room → rooms of THIS house), so AppChrome no
// longer needs to pass a rooms array.

const PUBLIC_PREFIXES = ["/welcome", "/login", "/auth/", "/m/", "/booking-terms"];

function isPublic(path: string): boolean {
  return PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(p));
}

type ShellState = {
  loaded: boolean;
  isOwner: boolean;
  isMulti: boolean;
  hasMemberships: boolean;
};

export default function AppChrome({ children }: { children: React.ReactNode }) {
  const path = usePathname() || "/";
  const [shell, setShell] = useState<ShellState>({
    loaded: false, isOwner: false, isMulti: false, hasMemberships: false,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/my-memberships", { cache: "no-store", credentials: "include" });
        if (!r.ok) throw new Error("bad status");
        const j = await r.json();
        if (cancelled) return;
        setShell({
          loaded: true,
          isOwner: !!j.isOwner,
          isMulti: !!j.isMulti,
          hasMemberships: Array.isArray(j.memberships) && j.memberships.length > 0,
        });
      } catch {
        if (!cancelled) setShell((s) => ({ ...s, loaded: true }));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (isPublic(path)) return <>{children}</>;

  // Until membership context resolves we render the FULL shell so we don't
  // flash-collapse the sidebar for admins on a slow API call. Slim mode is
  // an OPT-IN once the API confirms a single-role user.
  const slim = shell.loaded && shell.hasMemberships && !shell.isOwner && !shell.isMulti;

  if (slim) {
    return (
      <>
        <SlimTopBar />
        <div>{children}</div>
      </>
    );
  }

  // Owner / multi-role / unresolved → full shell. RoomSwitcher decides
  // itself whether to render (hidden on /studio, visible on /h/* + legacy
  // house-scoped paths).
  return (
    <>
      <DesktopSidebar />
      <div className="lg:hidden">
        <TopBar />
      </div>
      <div className="lg:pl-60">
        {/* Desktop-only room switcher row. The identity chip that used to
            live here was removed 2026-08-31 — the bottom-left chip in the
            sidebar is the canonical identity affordance. */}
        <div className="hidden lg:flex items-center justify-end gap-3 px-6 pt-3">
          <RoomSwitcher compact />
        </div>
        <div className="flex lg:hidden justify-end px-6 pt-3">
          <RoomSwitcher compact />
        </div>
        {children}
      </div>
    </>
  );
}

// --- Slim chrome for single-role users --------------------------------------
//
// Just the brand mark on the left, the user's name/avatar on the right. No
// pillar row, no sidebar, no room switcher — this user has ONE room and
// they're already in it.
function SlimTopBar() {
  const [profile, setProfile] = useState<MyProfile | null>(null);
  useEffect(() => { getMyProfile().then(setProfile); }, []);
  const displayName = profile?.name || profile?.email || "Guest";
  const initials = (() => {
    const n = displayName.trim();
    if (!n) return "?";
    const parts = n.split(/\s+/).slice(0, 2).map((x) => x[0] || "").join("");
    return parts.toUpperCase() || n.slice(0, 2).toUpperCase();
  })();
  return (
    <header
      className="sticky top-0 z-40 border-b border-black/10 bg-paper/90 backdrop-blur"
      style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 8px)" }}
    >
      <div className="mx-auto flex min-h-[44px] max-w-3xl items-center justify-between px-6 py-3">
        <Link href="/" aria-label="Home" className="flex items-center">
          <BrandMark entity="holdings" variant="mark" tone="light" />
        </Link>
        <div className="flex items-center gap-2">
          <span
            className="flex h-7 w-7 items-center justify-center rounded-full font-mono text-[10px] text-[#EFEEEB]"
            style={{ background: "var(--accent)" }}
            aria-hidden
          >
            {initials}
          </span>
          <span className="font-sans text-[12px] text-ink-soft truncate max-w-[9rem]">{displayName}</span>
          <AuthStatus />
        </div>
      </div>
    </header>
  );
}
