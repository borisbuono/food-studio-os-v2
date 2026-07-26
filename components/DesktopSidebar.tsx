"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { EntityKey, ENTITY_ORDER, ENTITY_SHORT, ENTITY_ACCENT } from "@/lib/entities";
import { setEntity as setEntityCtx, onCtx, readEntityCookie, writeCookie } from "@/lib/ctx";
import { PILLAR_ACCENT, PILLAR_LABEL, Pillar, pillarForRoute } from "@/lib/routing/pillar-map";
import { getMyProfile, MyProfile } from "@/lib/profile";
import { supabaseBrowser as sbBrowser } from "@/lib/supabaseBrowser";
import BrandMark from "@/components/BrandMark";

// Desktop-first vertical navigation rail. Rendered on lg+ (>= 1024px). On
// smaller viewports the sidebar hides (see md:hidden below) and the existing
// TopBar pill row remains authoritative — nothing regresses on mobile.
//
// Structure: entity switcher on top, three collapsible pillar sections
// (FOH · BOH · Office) with the aliased routes from pillar-map, then a
// Files jump, then user avatar + settings + sign-out. Each pillar section
// carries its own accent stripe on the active row so the eye can locate
// context without reading the label.

type Item = { href: string; label: string; badge?: string };
type Section = { pillar: Pillar; items: Item[] };

const SECTIONS: Section[] = [
  {
    pillar: "foh",
    items: [
      { href: "/foh",                    label: "Front dashboard" },
      { href: "/foh/bookings",           label: "Bookings" },
      { href: "/foh/pass",                label: "The Pass" },
      { href: "/foh/menu",                label: "Menu (consumer)" },
      { href: "/foh/guests",              label: "Guest arc" },
      { href: "/foh/reviews",             label: "Reviews" },
      { href: "/foh/academy",             label: "Service academy" },
      { href: "/grow/relationships",      label: "Relationships" },
      { href: "/grow/reputation",         label: "Reputation" },
      { href: "/grow/inbox",              label: "Guest inbox" },
      { href: "/m",                       label: "Guest surface" },
    ],
  },
  {
    pillar: "boh",
    items: [
      { href: "/boh",                     label: "Kitchen dashboard" },
      { href: "/boh/cook",                label: "Cook mode" },
      { href: "/boh/mep",                 label: "MEP" },
      { href: "/boh/recipes",             label: "Recipes" },
      { href: "/boh/menu",                label: "Menu (BOH)" },
      { href: "/boh/receiving",           label: "Receiving" },
      { href: "/boh/wine",                label: "Wine" },
      { href: "/boh/bar",                 label: "Bar" },
      { href: "/boh/academy",             label: "Kitchen academy" },
      { href: "/develop/menu",            label: "Menu develop" },
      { href: "/develop/lexicon",         label: "Lexicon" },
      { href: "/develop/repricing",       label: "Repricing" },
      { href: "/develop/menu-engineering",label: "Menu engineering" },
      { href: "/execute/orders",          label: "Place an order" },
      { href: "/execute/inventory",       label: "Inventory" },
      { href: "/execute/temp",            label: "Temps" },
      { href: "/execute/handover",        label: "Handover" },
    ],
  },
  {
    pillar: "office",
    items: [
      { href: "/office",                          label: "Office dashboard" },
      { href: "/administrate/finance",            label: "Finance" },
      { href: "/administrate/finance/reconciliation", label: "Reconciliation" },
      { href: "/administrate/finance/anomalies",  label: "Anomalies" },
      { href: "/administrate/finance/scans",      label: "Scan queue" },
      { href: "/administrate/finance/eod",        label: "EOD reports" },
      { href: "/administrate/invoices",           label: "Missing invoices" },
      { href: "/administrate/suppliers",          label: "Suppliers" },
      { href: "/administrate/team",               label: "Team" },
      { href: "/administrate/team/schedule",      label: "Schedule" },
      { href: "/administrate/events",             label: "Events" },
      { href: "/administrate/decisions",          label: "Decisions" },
      { href: "/administrate/holdings",           label: "Holdings" },
      { href: "/grow/reach",                      label: "Reach" },
      { href: "/grow/reach/calendar",             label: "Reach calendar" },
      { href: "/grow/commercials",                label: "Commercials" },
      { href: "/administrate/settings",           label: "Settings" },
    ],
  },
];

export default function DesktopSidebar() {
  const pathname = usePathname() || "";
  const activePillar = pillarForRoute(pathname);

  const [entity, setEntity] = useState<EntityKey>(() => {
    if (typeof window === "undefined") return "utopia";
    const c = readEntityCookie() as EntityKey | null;
    return c && (ENTITY_ORDER as string[]).includes(c) ? (c as EntityKey) : "utopia";
  });
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [entMenu, setEntMenu] = useState(false);
  const [open, setOpen] = useState<Record<Pillar, boolean>>(() => ({
    foh: activePillar === "foh",
    boh: activePillar === "boh",
    office: activePillar === "office" || activePillar === null,
  }));

  useEffect(() => { getMyProfile().then(setProfile); }, []);

  useEffect(() => {
    const read = () => {
      const e = (localStorage.getItem("fs_entity") as EntityKey | null) || (readEntityCookie() as EntityKey | null) || "utopia";
      setEntity(e); writeCookie(e);
    };
    read();
    return onCtx(read);
  }, []);

  useEffect(() => {
    // If the route moves into a new pillar, auto-open its section.
    if (activePillar) setOpen((s) => ({ ...s, [activePillar]: true }));
  }, [activePillar]);

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

  return (
    <aside
      data-desktop-sidebar
      className="hidden lg:flex fixed inset-y-0 left-0 z-30 w-60 flex-col border-r border-black/10 bg-paper/95 backdrop-blur"
      aria-label="Desktop navigation"
    >
      {/* Wordmark + entity switcher */}
      <div className="flex flex-col gap-3 border-b border-black/10 px-4 py-4">
        <Link href="/" className="flex items-center" aria-label="Home">
          <BrandMark entity={entity} variant="mark" tone="light" />
        </Link>
        {canSwitch ? (
          <div className="relative">
            <button
              onClick={() => setEntMenu((m) => !m)}
              className="flex w-full items-center gap-2 rounded-md border border-black/10 px-2.5 py-1.5 font-sans text-[12px] text-ink-soft hover:border-ink/40"
              aria-haspopup="listbox"
              aria-expanded={entMenu}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: ENTITY_ACCENT[entity] }} />
              <span className="flex-1 text-left truncate">{ENTITY_SHORT[entity]}</span>
              <span className="text-clay">▾</span>
            </button>
            {entMenu ? (
              <div className="absolute left-0 right-0 mt-1 z-10 overflow-hidden rounded-md border border-line bg-card shadow-xl" role="listbox">
                {ENTITY_ORDER.map((k) => (
                  <button
                    key={k}
                    onClick={() => { setEntityCtx(k); setEntity(k); setEntMenu(false); }}
                    className={"flex w-full items-center gap-2 px-2.5 py-1.5 text-left font-sans text-[12px] transition hover:bg-paper " + (k === entity ? "text-ink" : "text-ink-soft")}
                    role="option"
                    aria-selected={k === entity}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ background: ENTITY_ACCENT[k] }} />
                    {ENTITY_SHORT[k]}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <span
            className="flex items-center gap-2 rounded-md px-2.5 py-1.5 font-sans text-[12px] text-[#EFEEEB]"
            style={{ background: ENTITY_ACCENT[entity] }}
          >
            <span className="h-2 w-2 rounded-full bg-white/70" />
            {ENTITY_SHORT[entity]}
          </span>
        )}
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

      {/* Pillar sections */}
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {SECTIONS.map((section) => {
          const opened = open[section.pillar];
          const accent = PILLAR_ACCENT[section.pillar];
          return (
            <div key={section.pillar} className="mb-3">
              <button
                onClick={() => setOpen((s) => ({ ...s, [section.pillar]: !s[section.pillar] }))}
                className="flex w-full items-center justify-between rounded-md px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-clay hover:text-ink"
                aria-expanded={opened}
              >
                <span className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full" style={{ background: accent }} />
                  {PILLAR_LABEL[section.pillar]}
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

        {/* Files — universal escape hatch, distinct from pillars */}
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

      {/* Bottom: avatar / settings / sign-out */}
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
