"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { EntityKey, ENTITY_ORDER, ENTITY_SHORT, ENTITY_ACCENT, ENTITY_LABEL } from "@/lib/entities";
import { setEntity as setEntityCtx, onCtx, readEntityCookie, writeCookie } from "@/lib/ctx";
import { PILLAR_ACCENT, PILLAR_LABEL, Pillar, pillarForRoute } from "@/lib/routing/pillar-map";
import { getMyProfile, MyProfile } from "@/lib/profile";
import { supabaseBrowser as sbBrowser } from "@/lib/supabaseBrowser";
import BrandMark from "@/components/BrandMark";
import {
  sidebarForScope, entityTypeFor, entityTypeForUrl, scopeForUrl, resolveScope,
  EntityType, type Scope,
} from "@/lib/scope";
import {
  houseNameForSlug, HOUSE_ROOM_LABEL, houseSlugForEntity, HOUSE_SLUG_TO_ENTITY,
} from "@/lib/houses";
import { useSwitcherEntities } from "@/lib/useSwitcherEntities";

// Desktop-first vertical navigation rail. Rendered on lg+ (>= 1024px).
//
// Push (2026-08-31, Boris walk 09:50 CET) — three-level scope model:
//   • Studio scope → static "Food Studios" label at top (no venue picker),
//     STUDIO sidebar tree (Overview / Houses / People / Money / Command).
//   • House scope  → static house name ("Bistro Mondo") at top, full
//     operating tree grouped by room. Switcher shows only when the user
//     has multiple houses AND is on a house/room (single-house users
//     never see it — keeps the switcher-gating from a695dda alive).
//   • Room scope   → breadcrumb "Bistro Mondo · Kitchen" at top, only
//     that room's tree.
//
// The venue chip / dropdown that used to render for signed-in users on
// /studio is GONE — leaving it there made the user think they were inside
// BM when they were at portfolio level (the actual bug Boris named).

export default function DesktopSidebar() {
  const pathname = usePathname() || "";
  const activePillar = pillarForRoute(pathname);

  const [entity, setEntity] = useState<EntityKey>(() => {
    if (typeof window === "undefined") return "bistro_mondo";
    const c = readEntityCookie() as EntityKey | null;
    return c && (ENTITY_ORDER as string[]).includes(c) ? (c as EntityKey) : "bistro_mondo";
  });
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [entMenu, setEntMenu] = useState(false);

  const switcher = useSwitcherEntities();
  const totalEntities = switcher.operating.length + switcher.holding.length + switcher.portfolio.length;
  const hasMultipleEntities = !switcher.loading && totalEntities > 1;

  // Resolve the current three-level scope. resolveScope combines the URL
  // grammar (/studio, /h/<slug>, /h/<slug>/<room>) with the fs_entity
  // cookie fallback so /office bound to BM lifts into room(bm, office).
  const scope: Scope | null = useMemo(() => {
    const s = scopeForUrl(pathname);
    if (s) return s;
    return resolveScope(pathname, houseSlugForEntity(entity));
  }, [pathname, entity]);

  // Sidebar tree still keyed by entityType — a house shows the full
  // operating tree, a room shows just that room's section, studio shows
  // STUDIO. entityTypeForUrl handles the URL-first cases; the fallback is
  // the cookie-derived entityType (used when scope is a house/room derived
  // from a legacy path).
  const urlScopeType = entityTypeForUrl(pathname);
  const scopeType: EntityType = urlScopeType ?? entityTypeFor(entity);
  const sections = useMemo(() => sidebarForScope(scopeType), [scopeType]);

  // Sections open state.
  const [open, setOpen] = useState<Record<string, boolean>>({});
  useEffect(() => {
    setOpen((prev) => {
      const next: Record<string, boolean> = {};
      for (const s of sections) {
        next[s.key] = prev[s.key] ?? true;
      }
      if (activePillar) next[activePillar] = true;
      return next;
    });
  }, [sections, activePillar]);

  useEffect(() => { getMyProfile().then(setProfile); }, []);

  useEffect(() => {
    const read = () => {
      const e = (localStorage.getItem("fs_entity") as EntityKey | null) || (readEntityCookie() as EntityKey | null) || "bistro_mondo";
      setEntity(e); writeCookie(e);
    };
    read();
    return onCtx(read);
  }, []);

  const isAdmin = !!profile?.isAdmin;
  const canSwitch = isAdmin || !profile;

  const initials = useMemo(() => {
    const n = (profile?.name || profile?.email || "?").trim();
    if (!n) return "?";
    const parts = n.split(/\s+/).slice(0, 2).map((x) => x[0] || "").join("");
    return parts.toUpperCase() || n.slice(0, 2).toUpperCase();
  }, [profile]);

  async function signOut() {
    try { await sbBrowser.auth.signOut(); } catch {}
    if (typeof window !== "undefined") window.location.href = "/login";
  }

  const sectionAccent = (key: string): string => {
    if (key === "foh" || key === "boh" || key === "office") return PILLAR_ACCENT[key as Pillar];
    return "#3F4C28";
  };

  // "You are here" label — what the top of the sidebar reads. Studio scope
  // uses the studio brand as a static label; house scope names the house;
  // room scope names the house AND the room (breadcrumb). None of these
  // are dropdowns — house switching happens either via the switcher (when
  // the user has multiple houses) or via Studio → click another house tile.
  const hereLabel = useMemo(() => {
    if (!scope) return null;
    if (scope.level === "studio") return "Food Studios";
    if (scope.level === "house") return houseNameForSlug(scope.houseSlug);
    return `${houseNameForSlug(scope.houseSlug)} · ${HOUSE_ROOM_LABEL[scope.room]}`;
  }, [scope]);

  // Show the switcher dropdown only when the user is inside a house or a
  // room AND has multiple houses. On Studio scope we never show it (users
  // move between houses by clicking a tile on the Studio page).
  const showHouseSwitcher =
    !!scope && scope.level !== "studio" && hasMultipleEntities && canSwitch;

  return (
    <aside
      data-desktop-sidebar
      className="hidden lg:flex fixed inset-y-0 left-0 z-30 w-60 flex-col border-r border-black/10 bg-paper/95 backdrop-blur"
      aria-label="Desktop navigation"
    >
      {/* Wordmark + "you are here" label. Static text on Studio scope,
          dropdown on House/Room scope when the user has multiple houses. */}
      <div className="flex flex-col gap-3 border-b border-black/10 px-4 py-4">
        {/* Logo binds to the current SCOPE, not the fs_entity cookie. Boris
            re-walk 2026-08-31 17:40 CET: the logo was reading the cookie,
            so navigating to /studio while the cookie still said BM left
            the Bistro Mondo mark visible at the top of a Studio-scoped
            page. Scope wins: Studio → Food Studios; house/room → house. */}
        <Link href="/" className="flex items-center" aria-label="Home">
          <BrandMark
            entity={
              scope?.level === "studio"
                ? "holdings"
                : scope && (scope.level === "house" || scope.level === "room")
                  ? HOUSE_SLUG_TO_ENTITY[scope.houseSlug]
                  : entity
            }
            variant="mark"
            tone="light"
          />
        </Link>

        {hereLabel ? (
          showHouseSwitcher ? (
            <div className="relative">
              <button
                onClick={() => setEntMenu((m) => !m)}
                className="flex w-full items-center gap-2 rounded-md border border-black/10 px-2.5 py-1.5 font-sans text-[12px] text-ink hover:border-ink/40"
                aria-haspopup="listbox"
                aria-expanded={entMenu}
                title="Switch house"
              >
                <span className="h-2 w-2 rounded-full" style={{ background: ENTITY_ACCENT[entity] }} />
                <span className="flex-1 text-left truncate">{hereLabel}</span>
                <span className="text-clay">▾</span>
              </button>
              {entMenu ? (
                <div className="absolute left-0 right-0 mt-1 z-10 overflow-hidden rounded-md border border-line bg-card shadow-xl" role="listbox">
                  {switcher.loading ? (
                    <div className="px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wide text-clay">Loading…</div>
                  ) : null}
                  {switcher.operating.length ? <SwitcherGroupHeader label="Houses" /> : null}
                  {switcher.operating.map((ent) => (
                    <SwitcherRow
                      key={ent.id}
                      label={ent.name}
                      accent={ent.entityKey ? ENTITY_ACCENT[ent.entityKey] : "#3F4C28"}
                      selected={ent.entityKey === entity}
                      disabled={!ent.entityKey}
                      onClick={() => {
                        if (!ent.entityKey) return;
                        setEntityCtx(ent.entityKey);
                        setEntity(ent.entityKey);
                        setEntMenu(false);
                      }}
                    />
                  ))}
                  <SwitcherGroupHeader label="Studio" />
                  <a
                    href="/studio"
                    className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left font-sans text-[12px] text-ink-soft hover:bg-paper transition"
                  >
                    <span className="h-2 w-2 rounded-full" style={{ background: "#3F4C28" }} />
                    <span className="flex-1 truncate">Back to Food Studios</span>
                  </a>
                </div>
              ) : null}
            </div>
          ) : (
            <span
              className="flex items-center gap-2 rounded-md px-2.5 py-1.5 font-sans text-[12px] text-ink"
              title={hereLabel}
            >
              <span className="h-2 w-2 rounded-full" style={{
                background: scope && scope.level !== "studio" ? ENTITY_ACCENT[entity] : "#3F4C28",
              }} />
              <span className="flex-1 text-left truncate">{hereLabel}</span>
            </span>
          )
        ) : null}

        <button
          onClick={() => window.dispatchEvent(new CustomEvent("fs:cmdk:open"))}
          className="flex items-center justify-between rounded-md border border-black/10 px-2.5 py-1.5 font-sans text-[12px] text-ink-soft hover:border-ink/40"
          aria-label="Open command palette"
        >
          <span className="flex items-center gap-2">
            <svg width="12" height="12" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.4" />
              <path d="M14 14l3.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            Search or command…
          </span>
          <span className="rounded border border-black/15 bg-paper-deep px-1 font-mono text-[9px] uppercase text-clay">⌘K</span>
        </button>
      </div>

      {/* Scope-aware sections. */}
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {sections.map((section) => {
          const opened = open[section.key] ?? true;
          const accent = sectionAccent(section.key);
          return (
            <div key={section.key} className="mb-3">
              <button
                onClick={() => setOpen((s) => ({ ...s, [section.key]: !(s[section.key] ?? true) }))}
                className="flex w-full items-center justify-between rounded-md px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-clay hover:text-ink"
                aria-expanded={opened}
              >
                <span className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full" style={{ background: accent }} />
                  {section.label}
                </span>
                <span aria-hidden>{opened ? "−" : "+"}</span>
              </button>
              {opened ? (
                <ul className="mt-1 space-y-0.5">
                  {section.items.map((it) => {
                    const active = pathname === it.href || pathname.startsWith(it.href + "/");
                    return (
                      <li key={it.href}>
                        <Link
                          href={it.href}
                          className={
                            "group flex items-center justify-between rounded-md px-2 py-1 font-sans text-[13px] transition " +
                            (active
                              ? "bg-paper-deep text-ink font-medium"
                              : "text-ink-soft hover:bg-paper-deep hover:text-ink")
                          }
                          style={active ? { borderLeft: "2px solid " + accent, paddingLeft: "6px" } : undefined}
                        >
                          <span className="truncate">{it.label}</span>
                          {it.badge ? <span className="font-mono text-[9px] text-clay">{it.badge}</span> : null}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
          );
        })}

        {/* Files — universal escape hatch. */}
        <div className="mt-3 border-t border-black/10 pt-3">
          <Link
            href="/files"
            className={
              "flex items-center gap-2 rounded-md px-2 py-1.5 font-sans text-[13px] transition " +
              (pathname.startsWith("/files") ? "bg-paper-deep text-ink font-medium" : "text-ink-soft hover:bg-paper-deep hover:text-ink")
            }
          >
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M2.5 5.75c0-.69.56-1.25 1.25-1.25h4l1.5 1.75h6.5c.69 0 1.25.56 1.25 1.25v7.75c0 .69-.56 1.25-1.25 1.25H3.75c-.69 0-1.25-.56-1.25-1.25V5.75z" stroke="currentColor" strokeWidth="1.2"/>
            </svg>
            Files
          </Link>
          <Link
            href="/command"
            className={
              "mt-0.5 flex items-center gap-2 rounded-md px-2 py-1.5 font-sans text-[13px] transition " +
              (pathname.startsWith("/command") ? "bg-paper-deep text-ink font-medium" : "text-ink-soft hover:bg-paper-deep hover:text-ink")
            }
          >
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M4 5h12M4 10h12M4 15h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            Command center
          </Link>
        </div>
      </nav>

      {/* Bottom: avatar / settings / sign-out. This is the canonical identity
          affordance — the top-right chip in AppChrome was removed 2026-08-31. */}
      <div className="border-t border-black/10 px-2 py-3">
        <div className="flex items-center gap-2 px-1 py-1">
          <span
            className="flex h-8 w-8 items-center justify-center rounded-full font-mono text-[11px] text-[#EFEEEB]"
            style={{ background: "var(--accent)" }}
            aria-hidden
          >
            {initials}
          </span>
          <div className="flex-1 min-w-0">
            <p className="truncate font-sans text-[12px] text-ink">{profile?.name || profile?.email || "Guest"}</p>
            {profile?.dbRole ? <p className="truncate font-mono text-[9px] uppercase text-clay">{profile.dbRole}</p> : null}
          </div>
        </div>
        <div className="mt-1 flex items-center justify-between px-1">
          <Link
            href="/account"
            className="font-mono text-[10px] uppercase tracking-wide text-clay hover:text-ink"
          >
            Account
          </Link>
          <Link
            href="/administrate/settings"
            className="font-mono text-[10px] uppercase tracking-wide text-clay hover:text-ink"
          >
            Settings
          </Link>
          {profile ? (
            <button
              onClick={signOut}
              className="font-mono text-[10px] uppercase tracking-wide text-clay hover:text-tomato"
            >
              Sign out
            </button>
          ) : (
            <Link href="/login" className="font-mono text-[10px] uppercase tracking-wide text-clay hover:text-ink">Sign in</Link>
          )}
        </div>
      </div>
    </aside>
  );
}

// --- Switcher subcomponents -----------------------------------------------

function SwitcherGroupHeader({ label }: { label: string }) {
  return (
    <div className="px-2.5 pt-2 pb-1 font-mono text-[9px] uppercase tracking-wide text-clay">
      {label}
    </div>
  );
}

function SwitcherRow({
  label, accent, selected, disabled, hint, onClick,
}: {
  label: string; accent: string; selected: boolean; disabled?: boolean;
  hint?: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={
        "flex w-full items-center gap-2 px-2.5 py-1.5 text-left font-sans text-[12px] transition " +
        (disabled ? "cursor-not-allowed opacity-50" : "hover:bg-paper ") +
        (selected ? " text-ink" : " text-ink-soft")
      }
      role="option"
      aria-selected={selected}
      aria-disabled={disabled || undefined}
      title={disabled ? "Phase 3 — not yet routable" : undefined}
    >
      <span className="h-2 w-2 rounded-full" style={{ background: accent }} />
      <span className="flex-1 truncate">{label}</span>
      {hint ? <span className="font-mono text-[9px] uppercase text-clay">{hint}</span> : null}
    </button>
  );
}
