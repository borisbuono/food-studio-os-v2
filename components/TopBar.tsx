"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import AuthStatus from "@/components/AuthStatus";
import LangChooser from "@/components/LangChooser";
import CommandK from "@/components/CommandK";
import { EntityKey, ENTITY_ORDER, ENTITY_SHORT, ENTITY_ACCENT } from "@/lib/entities";
import { ROLES, RoleKey } from "@/lib/roles";
import BrandMark from "@/components/BrandMark";
import { getMyProfile, MyProfile } from "@/lib/profile";
import { setEntity as setEntityCtx, setRole as setRoleCtx, onCtx, writeCookie, readEntityCookie } from "@/lib/ctx";
import { pillarForRoute, PILLAR_ACCENT, PILLAR_LABEL, Pillar } from "@/lib/routing/pillar-map";

// Architecture v3 — top nav is the THREE pillars: FOH · BOH · Office.
// The old Develop/Execute/Administrate/Grow labels are gone from the nav;
// their temporal semantics live on tile-level "flow" chips.
//
// A small Files icon sits far-left of the pillar row (universal, above the
// pillars in the information hierarchy). The pillar the current route
// belongs to is highlighted with the pillar's accent line.

// The 3 top-level pillar entries.
const PILLARS: { key: Pillar; href: string; label: string }[] = [
  { key: "foh",    href: "/foh",    label: PILLAR_LABEL.foh },
  { key: "boh",    href: "/boh",    label: PILLAR_LABEL.boh },
  { key: "office", href: "/office", label: PILLAR_LABEL.office },
];

export default function TopBar() {
  const [entity, setEntity] = useState<EntityKey>(() => {
    const c = readEntityCookie() as EntityKey | null;
    return c && (ENTITY_ORDER as string[]).includes(c) ? (c as EntityKey) : "utopia";
  });
  const [role, setRole] = useState<RoleKey>("office");
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [loaded, setLoaded] = useState(false);
  const pathname = usePathname() || "";
  const activePillar = pillarForRoute(pathname);
  const [menu, setMenu] = useState(false);
  const [inboxCount, setInboxCount] = useState<number>(0);

  // load profile once
  useEffect(() => { getMyProfile().then((p) => { setProfile(p); setLoaded(true); }); }, []);

  // Poll the Files inbox needs-triage counter. Cheap: one indexed count, and
  // only when the user is signed in. Refreshes when the entity changes.
  useEffect(() => {
    if (!loaded) return;
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch("/api/files/inbox?status=needs_triage&limit=250", { cache: "no-store" });
        if (!r.ok) return;
        const j = await r.json();
        if (!cancelled) setInboxCount(Array.isArray(j?.rows) ? j.rows.length : 0);
      } catch { /* silent — the chip just stays at 0 */ }
    };
    load();
    const t = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [loaded, entity]);

  // keep entity/role + accent in sync with localStorage / other components
  useEffect(() => {
    const read = () => {
      const e = (localStorage.getItem("fs_entity") as EntityKey | null) || (readEntityCookie() as EntityKey | null) || "utopia";
      const r = (localStorage.getItem("fs_role") as RoleKey | null) || "office";
      setEntity(e); setRole(r); writeCookie(e);
      const ua = localStorage.getItem("fs_user_accent");
      document.documentElement.style.setProperty("--accent", ua || ENTITY_ACCENT[e] || "#B8552E");
    };
    read();
    return onCtx(read);
  }, []);

  const isAdmin = !!profile?.isAdmin;
  const scoped = !!profile && !profile.isAdmin;          // a worker bound to one venue
  const canSwitch = isAdmin || !profile;                  // admins + signed-out preview
  // The pillar nav is universal — every role now sees the three pillars,
  // gated at the DB (RLS) + at the route guard (RouteGuard) for Office-only screens.
  const pick = (k: EntityKey) => { setEntityCtx(k); setEntity(k); setMenu(false); };

  // Per-pillar accent for the active chip's underline / dot.
  const activeAccent = activePillar ? PILLAR_ACCENT[activePillar] : null;

  return (
    // Safe-area belt-and-braces (Boris walk 2026-08-07): the earlier fix
    // (10385b0) put paddingTop on the header, but on iOS PWA the inner row's
    // fixed py-3 wasn't reserving enough vertical run, so the "Boris" chip on
    // the right sometimes crept under the notch. Two extra guarantees now:
    //  1) paddingTop = max(env(...), 8px) so there's always visible clearance
    //     even in browser mode where env() resolves to 0.
    //  2) the inner row gets min-h-[44px] (iOS tap-target min) so the flex
    //     children can't collapse below what the notch demands.
    <header
      className="sticky top-0 z-40 border-b border-black/10 bg-paper/90 backdrop-blur"
      style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 8px)" }}
    >
      <div className="mx-auto flex min-h-[44px] max-w-3xl items-center justify-between px-6 py-3">
        <Link href="/" className="flex items-center"><BrandMark entity={entity} variant="mark" tone="light" /></Link>

        <div className="flex items-center gap-3">
          <CommandK />

          {/* entity context — top-right. Switcher for admins/preview, locked label for a scoped worker */}
          {loaded && canSwitch ? (
            <div className="relative">
              <button onClick={() => setMenu((m) => !m)} className="flex items-center gap-1.5 rounded-full border border-black/15 px-3 py-1.5 font-sans text-[12px] text-ink-soft transition hover:border-ink/40">
                <span className="h-2 w-2 rounded-full" style={{ background: ENTITY_ACCENT[entity] }} />
                {ENTITY_SHORT[entity]}
                <span className="text-clay">▾</span>
              </button>
              {menu ? (
                <div className="absolute right-0 mt-2 w-44 overflow-hidden rounded-xl border border-line bg-card shadow-xl shadow-black/15">
                  {ENTITY_ORDER.map((k) => (
                    <button key={k} onClick={() => pick(k)} className={"flex w-full items-center gap-2 px-3 py-2 text-left font-sans text-[13px] transition hover:bg-paper " + (k === entity ? "text-ink" : "text-ink-soft")}>
                      <span className="h-2 w-2 rounded-full" style={{ background: ENTITY_ACCENT[k] }} />
                      {ENTITY_SHORT[k]}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {loaded && scoped ? (
            <span className="flex items-center gap-1.5 rounded-full px-3 py-1.5 font-sans text-[12px] text-[#EFEEEB]" style={{ background: ENTITY_ACCENT[entity] }}>
              <span className="h-2 w-2 rounded-full bg-white/70" />
              {ENTITY_SHORT[entity]}
            </span>
          ) : null}

          <LangChooser />
          <AuthStatus />
        </div>
      </div>

      {/* Pillars — the THREE pillars of the OS. Files icon sits far-left as a
         universal escape hatch. The active pillar is underlined with its
         accent colour. */}
      {loaded ? (
        <nav className="mx-auto flex max-w-3xl items-center gap-4 border-t border-black/5 px-6 py-1.5 font-mono text-[10px] uppercase tracking-wide">
          <Link
            href={inboxCount > 0 ? "/files/inbox" : "/files"}
            title={inboxCount > 0 ? `Files inbox — ${inboxCount} awaiting triage` : "Files — HACCP, contracts, brand, gestoría"}
            className={"flex items-center " + (pathname.startsWith("/files") ? "text-ink" : "text-clay hover:text-ink")}
            aria-label={inboxCount > 0 ? `Files inbox, ${inboxCount} awaiting triage` : "Files"}
          >
            {/* Simple folder glyph. Kept as inline SVG so the nav stays a single
                render with no image request. */}
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M2.5 5.75c0-.69.56-1.25 1.25-1.25h4l1.5 1.75h6.5c.69 0 1.25.56 1.25 1.25v7.75c0 .69-.56 1.25-1.25 1.25H3.75c-.69 0-1.25-.56-1.25-1.25V5.75z" stroke="currentColor" strokeWidth="1.2"/>
            </svg>
            {inboxCount > 0 ? (
              <span
                className="ml-1 inline-flex min-w-[16px] items-center justify-center rounded-full bg-tomato px-1 font-mono text-[9px] leading-none text-paper"
                aria-hidden="true"
                title={`${inboxCount} awaiting triage`}
              >
                {inboxCount > 99 ? "99+" : inboxCount}
              </span>
            ) : null}
          </Link>
          {PILLARS.map((p) => {
            const isActive = activePillar === p.key;
            return (
              <Link
                key={p.key}
                href={p.href}
                className={(isActive ? "text-ink font-semibold" : "text-clay") + " hover:text-ink"}
                style={isActive && activeAccent ? { borderBottom: "1.5px solid", borderColor: activeAccent, paddingBottom: 1 } : undefined}
              >
                {p.label}
              </Link>
            );
          })}
        </nav>
      ) : null}

      {/* admin "view as" role line — admins preview each world; workers don't see this */}
      {loaded && isAdmin ? (
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-6 pb-2">
          <span className="font-mono text-[10px] uppercase tracking-wide text-clay">View as</span>
          {(Object.keys(ROLES) as RoleKey[]).map((k) => (
            <button key={k} onClick={() => { setRoleCtx(k); setRole(k); }} className={"rounded-full px-2.5 py-0.5 font-sans text-[11px] transition " + (k === role ? "text-[#EFEEEB]" : "text-ink-soft hover:text-ink")} style={k === role ? { background: "var(--accent)" } : undefined}>{ROLES[k].label}</button>
          ))}
        </div>
      ) : null}
    </header>
  );
}
