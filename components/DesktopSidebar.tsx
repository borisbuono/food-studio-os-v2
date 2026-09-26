"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { isPrimaryEntity, EntityKey, ENTITY_ORDER, ENTITY_SHORT, ENTITY_ACCENT, ENTITY_LABEL, E_BM, E_TALLER, E_HOLDINGS } from "@/lib/entities";
import { setEntity as setEntityCtx, onCtx, readEntityCookie, writeCookie } from "@/lib/ctx";
import { getMyProfile, MyProfile } from "@/lib/profile";
import type { ServerProfile } from "@/lib/serverProfile";
import { supabaseBrowser as sbBrowser } from "@/lib/supabaseBrowser";
import BrandMark from "@/components/BrandMark";
import {
  entityTypeFor, entityTypeForUrl, scopeForUrl, resolveScope, resolveHouseHref,
  EntityType, type Scope,
} from "@/lib/scope";
import { houseNameForSlug, HOUSE_ROOM_LABEL, houseSlugForEntity } from "@/lib/houses";
import { treeForPath, verbsFor, activeVerb, LEAVES_VISIBLE, type NavVerb } from "@/lib/nav";
import { readRecent, touchRecent, orderByRecent, type RecentMap } from "@/lib/nav/recent";
import { useSwitcherEntities, type SwitcherEntry } from "@/lib/useSwitcherEntities";
import { brandForScope, scopeEntity as scopeEntityFor, hrefForHouseSwitch } from "@/lib/brandScope";
import { Z } from "@/lib/ui/z";

// Desktop-first vertical navigation rail. Rendered on lg+ (>= 1024px).
//
// Slim OS, slice 1 (2026-09-26, critic Direction A "Dock"): the rail is the
// six House verbs — Serve · Cook · Buy · Close · People · Reach — as plain
// words in one typeface; the active verb is heavier, not coloured; its
// leaves (≤ 5, recent-first for this person, rest under "more") sit under
// it. Studio shows Houses · Money · People · Reach · System; /me shows
// Today · Calendar · Learn · Account. The Chef control docks at the foot
// (padding-bottom: --chef-dock). No room trees, no section dots, no Files /
// Command-center escape hatches — those are leaves now.
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

export default function DesktopSidebar({ initialEntity, initialProfile }: { initialEntity?: EntityKey; initialProfile?: ServerProfile | null }) {
  const pathname = usePathname() || "";
  const router = useRouter();

  const [entity, setEntity] = useState<EntityKey>(() => {
    // Seed from the SERVER-resolved entity (threaded from layout.tsx) so the
    // first client render matches the server HTML. readEntityCookie() reads
    // document.cookie, which is unavailable during SSR — seeding from it made
    // the server emit bistro_mondo and the client flip on hydration.
    // Boris walk 2026-09-20 (runway d1): fallback default is "holdings"
    // (the neutral studio scope), not "bistro_mondo" — a fresh tenant with
    // no cookie was getting a Bistro-Mondo-branded sidebar on first paint.
    if (initialEntity) return initialEntity;
    if (typeof window === "undefined") return E_HOLDINGS;
    const c = readEntityCookie() as EntityKey | null;
    return c && (ENTITY_ORDER as string[]).includes(c) ? (c as EntityKey) : E_HOLDINGS;
  });
  // Seed from the server-resolved profile so the sidebar identity chip
  // paints Boris on first render instead of flashing "Guest" and flipping.
  const [profile, setProfile] = useState<MyProfile | null>(
    (initialProfile as unknown as MyProfile | null) ?? null,
  );
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

  const brand = useMemo(() => brandForScope(scope, entity), [scope, entity]);
  const hereEntity = scopeEntityFor(scope, entity);
  const hereAccent = (hereEntity ? ENTITY_ACCENT[hereEntity] : null) || "#3F4C28";

  // Picking a house in the switcher. On /h/<slug>/** the URL IS the scope,
  // so swapping only the cookie changed nothing on screen — navigate to the
  // same room in the other house. On legacy cookie-bound paths, swap the
  // cookie and refresh so server components re-resolve.
  const pickHouse = (ent: SwitcherEntry) => {
    setEntMenu(false);
    if (ent.entityKey) { setEntityCtx(ent.entityKey); setEntity(ent.entityKey); }
    const target = ent.slug ? hrefForHouseSwitch(pathname, ent.slug) : null;
    if (target) router.push(target);
    else if (ent.slug && !ent.entityKey) router.push(`/h/${ent.slug}`);
    else router.refresh();
  };

  // Which tree: /studio/* (or a holding-company cookie on a legacy path) →
  // Studio; /me, /account, /install → me; everything else → the six verbs.
  const urlScopeType = entityTypeForUrl(pathname);
  const scopeType: EntityType = urlScopeType ?? entityTypeFor(entity);
  const studioScope = scopeType === "studio" || scopeType === "holding_company";
  const tree = treeForPath(pathname, studioScope);
  const verbs = verbsFor(tree);
  // "{house}" hrefs resolve against the house in scope and vanish without one.
  const houseSlug = scope && scope.level !== "studio" ? scope.houseSlug : null;

  // Meta inbox waiting count (2026-09-23) — the number under Reach.
  // Read through RLS (social_inbox_waiting is security_invoker), keyed on the
  // house slug in scope, refreshed on every route change and every 2 min.
  const [inboxWaiting, setInboxWaiting] = useState<number>(0);
  useEffect(() => {
    let dead = false;
    if (!houseSlug) { setInboxWaiting(0); return; }
    const load = async () => {
      const { data: ent } = await sbBrowser.from("entities").select("id").eq("slug", houseSlug).maybeSingle();
      if (!ent?.id || dead) return;
      const { data } = await sbBrowser.from("social_inbox_waiting").select("waiting").eq("entity_id", ent.id).maybeSingle();
      if (!dead) setInboxWaiting(Number((data as any)?.waiting ?? 0));
    };
    load().catch(() => {});
    const t = setInterval(() => { load().catch(() => {}); }, 120_000);
    return () => { dead = true; clearInterval(t); };
  }, [houseSlug, pathname]);

  // Personal leaf order: every route change stamps the path; leaves you have
  // opened rise above the "more" line (lib/nav/recent.ts).
  const [recent, setRecent] = useState<RecentMap>({});
  useEffect(() => { setRecent(touchRecent(pathname)); }, [pathname]);
  useEffect(() => { setRecent(readRecent()); }, []);
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => { setMoreOpen(false); }, [pathname]);

  const active = useMemo(() => activeVerb(verbs, pathname, houseSlug), [verbs, pathname, houseSlug]);

  useEffect(() => { getMyProfile().then((p) => { if (p) setProfile(p); }); }, []);

  useEffect(() => {
    const read = () => {
      // Cookie wins (task #27): the server forces it on sign-in, and a
      // stale localStorage value from another user/device must not win
      // and get written back over it.
      // A self-serve tenant's entity is a UUID that isn't one of the pinned
      // four, so accept any UUID-shaped value rather than only pinned ones.
      const ok = (v: string | null) => !!v && (isPrimaryEntity(v) || /^[0-9a-f-]{36}$/i.test(v));
      const ck = readEntityCookie();
      const ls = localStorage.getItem("fs_entity");
      const e = (ok(ck) ? ck : ok(ls) ? ls : E_HOLDINGS) as EntityKey;
      try { if (ls !== e) localStorage.setItem("fs_entity", e); } catch {}
      setEntity(e); writeCookie(e);
    };
    read();
    return onCtx(read);
    // Re-read on every navigation (2026-09-22): middleware binds fs_entity
    // when the user enters /h/<slug>, but this component lives in the root
    // layout and never remounts, so without this `entity` kept the sign-in
    // value (holdings) and the first legacy link in the house tree —
    // Recipes → /develop/recipes — resolved against holdings: Studio brand,
    // Holdings tree, "Reach calendar" where Kitchen should be.
  }, [pathname]);

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
      className="hidden lg:flex fixed inset-y-0 left-0 w-52 flex-col border-r border-black/10 bg-paper/95 backdrop-blur"
      // Chef v3: the control docks at the bottom of this column, inside the
      // reserve — the identity block sits above it, never under it.
      style={{ zIndex: Z.sticky, paddingBottom: "var(--chef-dock)" }}
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
        {/* Logo AND its link bind to the current SCOPE (task #61) — never to
            the fs_entity cookie. Studio -> Food Studios -> /studio; house/room
            -> that house -> /h/<slug>; unknown house -> its name as wordmark. */}
        <Link href={brand.href} className="flex items-center" aria-label="Home" data-testid="sidebar-brand-mark">
          <BrandMark entity={brand.entity} name={brand.name} tone="light" />
        </Link>

        {hereLabel ? (
          showHouseSwitcher ? (
            <div className="relative">
              {/* Task #27: the switcher is LOUD — filled in the house's accent,
                  labelled, so nobody mistakes which house they're writing
                  into. It used to be a hairline chip that read like a label. */}
              <button
                onClick={() => setEntMenu((m) => !m)}
                data-testid="house-switcher"
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left shadow-sm ring-1 ring-black/10 transition hover:brightness-110"
                style={{ background: hereAccent, color: "#FFFFFF" }}
                aria-haspopup="listbox"
                aria-expanded={entMenu}
                title="Switch house"
              >
                <span className="flex-1 min-w-0">
                  <span className="block font-mono text-[9px] uppercase tracking-[0.14em] opacity-80">You are in</span>
                  <span className="block truncate font-sans text-[14px] font-semibold leading-tight">{hereLabel}</span>
                </span>
                <span className="rounded-md bg-white/20 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide">Switch ▾</span>
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
                      selected={ent.entityKey ? ent.entityKey === hereEntity : (!!scope && "houseSlug" in scope && scope.houseSlug === ent.slug)}
                      disabled={!ent.entityKey && !ent.slug}
                      onClick={() => pickHouse(ent)}
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
                background: hereAccent,
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

      {/* The verbs. One typeface; the active verb is heavier, not coloured. */}
      <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Verbs">
        <ul className="space-y-0.5">
          {verbs.map((v: NavVerb) => {
            const href = resolveHouseHref(v.href, houseSlug);
            if (!href) return null;
            const isActive = active?.key === v.key;
            const waiting = v.key === "reach" && tree === "house" && inboxWaiting > 0 ? inboxWaiting : 0;
            const leaves = orderByRecent(
              v.leaves.map((l) => ({ ...l, href: resolveHouseHref(l.href, houseSlug) || "" })).filter((l) => l.href),
              recent,
            );
            const shown = moreOpen ? leaves : leaves.slice(0, LEAVES_VISIBLE);
            const hidden = leaves.length - shown.length;
            const pathOf = (h: string) => h.split("?")[0];
            return (
              <li key={v.key}>
                <Link
                  href={href}
                  data-verb={v.key}
                  aria-current={isActive ? "page" : undefined}
                  className={
                    "flex items-baseline justify-between rounded-md px-2 py-1.5 font-sans text-[15px] transition " +
                    (isActive ? "text-ink font-semibold" : "text-ink-soft hover:text-ink")
                  }
                >
                  <span>{v.label}</span>
                  {waiting ? <span className="font-mono text-[11px] text-ink-soft">{waiting}</span> : null}
                </Link>
                {isActive && leaves.length ? (
                  <ul className="mb-2 mt-0.5 space-y-0.5 pl-2" data-leaves={v.key}>
                    {shown.map((l) => {
                      const on = pathname === pathOf(l.href) || pathname.startsWith(pathOf(l.href) + "/");
                      return (
                        <li key={l.href}>
                          <Link
                            href={l.href}
                            className={
                              "block truncate rounded-md px-2 py-1 font-sans text-[13px] transition " +
                              (on ? "text-ink font-medium" : "text-ink-soft hover:text-ink")
                            }
                          >
                            {l.label}
                          </Link>
                        </li>
                      );
                    })}
                    {hidden > 0 ? (
                      <li>
                        <button type="button" onClick={() => setMoreOpen(true)} className="px-2 py-1 font-sans text-[13px] text-clay hover:text-ink">
                          more · {hidden}
                        </button>
                      </li>
                    ) : moreOpen && leaves.length > LEAVES_VISIBLE ? (
                      <li>
                        <button type="button" onClick={() => setMoreOpen(false)} className="px-2 py-1 font-sans text-[13px] text-clay hover:text-ink">
                          less
                        </button>
                      </li>
                    ) : null}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
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
            href="/me/today"
            className="font-mono text-[10px] uppercase tracking-wide text-clay hover:text-ink"
          >
            Today
          </Link>
          <Link
            href="/account"
            className="font-mono text-[10px] uppercase tracking-wide text-clay hover:text-ink"
          >
            Account
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
