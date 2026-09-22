"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { isPrimaryEntity, EntityKey, ENTITY_ORDER, ENTITY_SHORT, ENTITY_ACCENT, E_BM, E_TALLER, E_HOLDINGS } from "@/lib/entities";
import { ROLES, RoleKey } from "@/lib/roles";
import BrandMark from "@/components/BrandMark";
import { getMyProfile, MyProfile } from "@/lib/profile";
import type { ServerProfile } from "@/lib/serverProfile";
import { setEntity as setEntityCtx, setRole as setRoleCtx, onCtx, writeCookie, readEntityCookie } from "@/lib/ctx";
import { pillarForRoute, PILLAR_ACCENT, PILLAR_LABEL, Pillar } from "@/lib/routing/pillar-map";
import { scopeForUrl, resolveScope } from "@/lib/scope";
import { HOUSE_SLUG_TO_ENTITY, houseSlugForEntity } from "@/lib/houses";
import { useSwitcherEntities, type SwitcherEntry } from "@/lib/useSwitcherEntities";
import { brandForScope, scopeEntity as scopeEntityFor, hrefForHouseSwitch } from "@/lib/brandScope";

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

export default function TopBar({ initialEntity, initialProfile }: { initialEntity?: EntityKey; initialProfile?: ServerProfile | null }) {
  const [entity, setEntity] = useState<EntityKey>(() => {
    // Seed from the SERVER-resolved entity (threaded from layout.tsx) so the
    // first client render matches the server HTML. readEntityCookie() reads
    // document.cookie, which is unavailable during SSR — seeding from it made
    // the server emit bistro_mondo and the client flip on hydration.
    // Boris walk 2026-09-20 (runway d1): fallback default is "holdings"
    // (the neutral studio scope), not "bistro_mondo" — a fresh tenant with
    // no cookie was getting BM tomato branding on first paint.
    if (initialEntity) return initialEntity;
    const c = readEntityCookie() as EntityKey | null;
    return c && (ENTITY_ORDER as string[]).includes(c) ? (c as EntityKey) : E_HOLDINGS;
  });
  const [role, setRole] = useState<RoleKey>("office");
  // Seed from the server-resolved profile so the top bar chip paints
  // the operator on first render instead of flashing "Guest".
  const [profile, setProfile] = useState<MyProfile | null>(
    (initialProfile as unknown as MyProfile | null) ?? null,
  );
  const [loaded, setLoaded] = useState(false);
  const pathname = usePathname() || "";
  const router = useRouter();
  const activePillar = pillarForRoute(pathname);
  const [menu, setMenu] = useState(false);
  const switcher = useSwitcherEntities();
  // Switcher visibility (2026-08-30): hide the entity switcher entirely for
  // users with only one accessible entity. Single-house operators shouldn't
  // even know the concept exists.
  const totalEntities = switcher.operating.length + switcher.holding.length + switcher.portfolio.length;
  const hasMultipleEntities = !switcher.loading && totalEntities > 1;
  const [inboxCount, setInboxCount] = useState<number>(0);

  // load profile once
  useEffect(() => { getMyProfile().then((p) => { if (p) setProfile(p); setLoaded(true); }); }, []);

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
      const r = (localStorage.getItem("fs_role") as RoleKey | null) || "office";
      setEntity(e); setRole(r); writeCookie(e);
      const ua = localStorage.getItem("fs_user_accent");
      document.documentElement.style.setProperty("--accent", ua || ENTITY_ACCENT[e] || "#B8552E");
    };
    read();
    return onCtx(read);
    // Re-read on every navigation (2026-09-22): middleware binds fs_entity
    // when the user enters /h/<slug>, but this component lives in the root
    // layout and never remounts, so without this the state kept the
    // sign-in value and the next legacy link resolved against it.
  }, [pathname]);

  const isAdmin = !!profile?.isAdmin;
  const scoped = !!profile && !profile.isAdmin;          // a worker bound to one venue
  const canSwitch = isAdmin || !profile;                  // admins + signed-out preview
  // The pillar nav is universal — every role now sees the three pillars,
  // gated at the DB (RLS) + at the route guard (RouteGuard) for Office-only screens.
  const pick = (k: EntityKey) => { setEntityCtx(k); setEntity(k); setMenu(false); };
  // Scope-bound identity (task #61): logo, link and switcher colour follow
  // the URL scope; the cookie only fills in on legacy paths.
  const scopeNow = resolveScope(pathname, houseSlugForEntity(entity));
  const brand = brandForScope(scopeNow, entity);
  const hereEntity = scopeEntityFor(scopeNow, entity);
  const hereAccent = (hereEntity ? ENTITY_ACCENT[hereEntity] : null) || "#3F4C28";
  const hereShort = (hereEntity ? ENTITY_SHORT[hereEntity] : null) || brand.name || "House";
  // House switch: navigate when the URL carries the house (/h/<slug>/…),
  // otherwise swap the cookie and refresh the server components.
  const pickHouse = (ent: SwitcherEntry) => {
    setMenu(false);
    if (ent.entityKey) { setEntityCtx(ent.entityKey); setEntity(ent.entityKey); }
    const target = ent.slug ? hrefForHouseSwitch(pathname, ent.slug) : null;
    if (target) router.push(target);
    else if (ent.slug && !ent.entityKey) router.push(`/h/${ent.slug}`);
    else router.refresh();
  };

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
        {/* Logo binds to the current SCOPE, not the fs_entity cookie. Boris walk
            2026-09-11: on /studio the mobile top bar still showed the BM mark
            (cookie-bound) even though the page header read "Food Studios". The
            desktop sidebar was already scope-bound (2026-08-31); this brings
            the mobile chrome in line so both surfaces resolve the same way.
            Studio → holdings; house/room → the house mark; fallback → cookie
            (only reachable when scope is null on legacy paths). */}
        <Link href={brand.href} data-testid="top-brand-mark" aria-label="Home" className="flex items-center">
          <BrandMark entity={brand.entity} name={brand.name} tone="light" />
        </Link>

        <div className="flex items-center gap-3">

          {/* entity context — top-right. Switcher for admins/preview, locked label for a scoped worker */}
          {loaded && hasMultipleEntities && canSwitch ? (
            <div className="relative">
              {/* Task #27: loud switcher — filled in the house accent, bold. */}
              <button
                onClick={() => setMenu((m) => !m)}
                data-testid="house-switcher-mobile"
                className="flex items-center gap-1.5 rounded-full px-3.5 py-1.5 font-sans text-[13px] font-semibold text-white shadow-sm ring-1 ring-black/10 transition hover:brightness-110"
                style={{ background: hereAccent }}
                aria-haspopup="listbox"
                aria-expanded={menu}
              >
                {hereShort}
                <span className="opacity-80">▾</span>
              </button>
              {menu ? (
                <div className="absolute right-0 mt-2 w-52 overflow-hidden rounded-xl border border-line bg-card shadow-xl shadow-black/15">
                  {switcher.loading ? (
                    <div className="px-3 py-2 font-mono text-[10px] uppercase tracking-wide text-clay">Loading…</div>
                  ) : null}
                  {switcher.operating.length ? (
                    <div className="px-3 pt-2 pb-1 font-mono text-[9px] uppercase tracking-wide text-clay">Venues</div>
                  ) : null}
                  {switcher.operating.map((ent) => (
                    <button
                      key={ent.id}
                      disabled={!ent.entityKey && !ent.slug}
                      onClick={() => pickHouse(ent)}
                      className={"flex w-full items-center gap-2 px-3 py-2 text-left font-sans text-[13px] transition " + (ent.entityKey || ent.slug ? "hover:bg-paper " : "cursor-not-allowed opacity-50 ") + (ent.entityKey && ent.entityKey === hereEntity ? "text-ink font-semibold" : "text-ink-soft")}
                    >
                      <span className="h-2 w-2 rounded-full" style={{ background: ent.entityKey ? ENTITY_ACCENT[ent.entityKey] : "#7A7A75" }} />
                      {ent.name}
                    </button>
                  ))}
                  {switcher.holding.length ? (
                    <div className="px-3 pt-2 pb-1 font-mono text-[9px] uppercase tracking-wide text-clay">Group</div>
                  ) : null}
                  {switcher.holding.map((ent) => (
                    <button
                      key={ent.id}
                      disabled={!ent.entityKey}
                      onClick={() => { if (ent.entityKey) { pick(ent.entityKey); } router.push("/studio"); }}
                      className={"flex w-full items-center gap-2 px-3 py-2 text-left font-sans text-[13px] transition " + (ent.entityKey ? "hover:bg-paper " : "cursor-not-allowed opacity-50 ") + (ent.entityKey === entity ? "text-ink" : "text-ink-soft")}
                    >
                      <span className="h-2 w-2 rounded-full" style={{ background: ent.entityKey ? ENTITY_ACCENT[ent.entityKey] : "#7A7A75" }} />
                      {ent.name}
                    </button>
                  ))}
                  {switcher.portfolio.length ? (
                    <div className="px-3 pt-2 pb-1 font-mono text-[9px] uppercase tracking-wide text-clay">Portfolio</div>
                  ) : null}
                  {switcher.portfolio.map((ent) => (
                    <button
                      key={ent.id}
                      disabled
                      title="Phase 3 — not yet routable"
                      className="flex w-full items-center gap-2 px-3 py-2 text-left font-sans text-[13px] transition cursor-not-allowed opacity-50 text-ink-soft"
                    >
                      <span className="h-2 w-2 rounded-full" style={{ background: "#7A7A75" }} />
                      <span className="flex-1 truncate">{ent.name}</span>
                      <span className="font-mono text-[9px] uppercase text-clay">{ent.entity_type.replace("_", " ")}</span>
                    </button>
                  ))}
                  {(!switcher.loading && !switcher.operating.length && !switcher.holding.length && !switcher.portfolio.length) ? (
                    <div className="px-3 py-2 font-mono text-[10px] uppercase tracking-wide text-clay">No entities</div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
          {loaded && scoped && hasMultipleEntities ? (
            <span className="flex items-center gap-1.5 rounded-full px-3 py-1.5 font-sans text-[12px] text-[#EFEEEB]" style={{ background: hereAccent }}>
              <span className="h-2 w-2 rounded-full bg-white/70" />
              {hereShort}
            </span>
          ) : null}

          {/* LangChooser removed 2026-09-10 — language is a one-time choice
              made in onboarding / Settings, not a chip in the app chrome. */}
          {/* AuthStatus (top-right "boris" identity chip) removed 2026-09-10
              (Boris walk). The canonical identity affordance is the
              bottom-left chip in DesktopSidebar (avatar · account · settings
              · sign out). Two chips reading the same name was noise. */}
        </div>
      </div>

      {/* Pillars — the THREE pillars of the OS. Files icon sits far-left as a
         universal escape hatch. The active pillar is underlined with its
         accent colour.
         Boris walk 2026-09-11: the gate flipped from `scopeForUrl === null`
         to `resolveScope === null`. The old gate was URL-only, so legacy
         paths (/office, /boh, /foh) always rendered the pillar row even
         though the RoomSwitcher was ALSO rendering there (via the
         resolveScope fallback that lifts an fs_entity=bistro_mondo cookie
         into a house/room scope). That stacked THREE nav systems on /office
         — pillars, "View as" role toggle, and RoomSwitcher. Now: whenever
         RoomSwitcher renders (any resolved scope), suppress the pillars.
         The row is still useful on truly-portfolio paths where no scope
         resolves at all (unauthenticated, /account without a house cookie,
         etc.). */}
      {loaded && resolveScope(pathname, houseSlugForEntity(entity)) === null ? (
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

      {/* admin "view as" role line — admins preview each world; workers don't see this.
         Boris walk 2026-09-11: also suppressed on any resolved scope, same
         reason as the pillar row above — the RoomSwitcher is the canonical
         inter-room nav and this legacy toggle stacked on top of it on
         /office and every other legacy-path-with-house-cookie. Kept on
         truly-legacy portfolio paths so admin preview still works there. */}
      {loaded && isAdmin && resolveScope(pathname, houseSlugForEntity(entity)) === null ? (
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
