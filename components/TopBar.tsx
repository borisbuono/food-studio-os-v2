"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { isPrimaryEntity, EntityKey, ENTITY_ORDER, ENTITY_SHORT, ENTITY_ACCENT, E_BM, E_TALLER, E_HOLDINGS } from "@/lib/entities";
import BrandMark from "@/components/BrandMark";
import { getMyProfile, MyProfile } from "@/lib/profile";
import type { ServerProfile } from "@/lib/serverProfile";
import { setEntity as setEntityCtx, onCtx, writeCookie, readEntityCookie } from "@/lib/ctx";
import { scopeForUrl, resolveScope } from "@/lib/scope";
import { HOUSE_SLUG_TO_ENTITY, houseSlugForEntity } from "@/lib/houses";
import { useSwitcherEntities, type SwitcherEntry } from "@/lib/useSwitcherEntities";
import { brandForScope, scopeEntity as scopeEntityFor, hrefForHouseSwitch } from "@/lib/brandScope";
import { Z } from "@/lib/ui/z";

// Phone top bar: brand mark (scope-bound) + house switcher. Nothing else —
// the verbs are in the dock (slim OS, 2026-09-26).

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
  // Seed from the server-resolved profile so the top bar chip paints
  // the operator on first render instead of flashing "Guest".
  const [profile, setProfile] = useState<MyProfile | null>(
    (initialProfile as unknown as MyProfile | null) ?? null,
  );
  const [loaded, setLoaded] = useState(false);
  const pathname = usePathname() || "";
  const router = useRouter();
  const [menu, setMenu] = useState(false);
  const switcher = useSwitcherEntities();
  // Switcher visibility (2026-08-30): hide the entity switcher entirely for
  // users with only one accessible entity. Single-house operators shouldn't
  // even know the concept exists.
  const totalEntities = switcher.operating.length + switcher.holding.length + switcher.portfolio.length;
  const hasMultipleEntities = !switcher.loading && totalEntities > 1;
  // load profile once
  useEffect(() => { getMyProfile().then((p) => { if (p) setProfile(p); setLoaded(true); }); }, []);

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
      setEntity(e); writeCookie(e);
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
      className="sticky top-0 border-b border-black/10 bg-paper/90 backdrop-blur"
      style={{ zIndex: Z.sticky, paddingTop: "max(env(safe-area-inset-top, 0px), 8px)" }}
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

      {/* The pillar row (FOH · BOH · Office) and the admin "View as" toggle
          left 2026-09-26 (slim OS, slice 1): on the phone the six verbs live
          in the dock inside the Chef band (components/nav/Dock.tsx); rooms
          are no longer a nav level. */}
    </header>
  );
}
