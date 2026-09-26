"use client";

// Dock — the phone nav, inside the Chef band (slim OS slice 1, 2026-09-26).
//
// Boris's ruling on the critic's flag 1: the bottom band is ONE fixed
// reserve = the Chef control + its chips + this dock's grip; the six-verb
// row sits in the same band when open. Nothing else is fixed down there.
//
//   idle (/h/<slug>)        grip only   → reserve 120 px (+ safe area)
//   grip swiped / verb open six words   → reserve 164 px  (body[data-dock=open])
//   a verb word tapped twice → its leaves (≤ 5 recent-first, rest under more)
//                              as a sheet above the row
//
// Rendered by ChefRoot for phone widths only (the desktop rail is
// DesktopSidebar). No colour: weight marks the active verb.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { resolveHouseHref } from "@/lib/scope";
import { treeForPath, verbsFor, activeVerb, LEAVES_VISIBLE, type NavVerb } from "@/lib/nav";
import { readRecent, touchRecent, orderByRecent, type RecentMap } from "@/lib/nav/recent";

type Props = { pathname: string; houseSlug: string | null; studioScope: boolean; enabled: boolean };

export default function Dock({ pathname, houseSlug, studioScope, enabled }: Props) {
  const router = useRouter();
  const tree = treeForPath(pathname, studioScope);
  const verbs = verbsFor(tree);
  const active = useMemo(() => activeVerb(verbs, pathname, houseSlug), [verbs, pathname, houseSlug]);

  // Open when the person asked (grip) or when standing inside a verb; the
  // idle screen shows the grip alone. Manual choice resets on navigation.
  const [manual, setManual] = useState<boolean | null>(null);
  const [leavesFor, setLeavesFor] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => { setManual(null); setLeavesFor(null); setMoreOpen(false); }, [pathname]);
  const open = enabled && (manual ?? !!active);

  const [recent, setRecent] = useState<RecentMap>({});
  useEffect(() => { setRecent(touchRecent(pathname)); }, [pathname]);
  useEffect(() => { setRecent(readRecent()); }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (open) document.body.setAttribute("data-dock", "open");
    else document.body.removeAttribute("data-dock");
    return () => { document.body.removeAttribute("data-dock"); };
  }, [open]);

  // Grip: tap toggles; a short vertical swipe does the same in the obvious direction.
  const touchY = useRef<number | null>(null);
  const onTouchStart = (e: React.TouchEvent) => { touchY.current = e.touches[0]?.clientY ?? null; };
  const onTouchEnd = (e: React.TouchEvent) => {
    const y0 = touchY.current; touchY.current = null;
    const y1 = e.changedTouches[0]?.clientY;
    if (y0 == null || y1 == null) return;
    const dy = y0 - y1;
    if (dy > 18) setManual(true);
    else if (dy < -18) { setManual(false); setLeavesFor(null); }
  };

  if (!enabled) return null;

  const leavesVerb: NavVerb | null = leavesFor ? verbs.find((v) => v.key === leavesFor) || null : null;
  const leaves = leavesVerb
    ? orderByRecent(leavesVerb.leaves.map((l) => ({ ...l, href: resolveHouseHref(l.href, houseSlug) || "" })).filter((l) => l.href), recent)
    : [];
  const shown = moreOpen ? leaves : leaves.slice(0, LEAVES_VISIBLE);

  return (
    <div
      data-dock
      className="pointer-events-none absolute inset-x-0 flex flex-col items-stretch"
      style={{ bottom: "calc(96px + env(safe-area-inset-bottom, 0px))" }}
    >
      {leavesVerb && leaves.length ? (
        <div className="pointer-events-auto mx-3 mb-2 rounded-2xl border border-line bg-paper px-2 py-2 shadow-lg" role="menu" aria-label={leavesVerb.label}>
          <ul className="max-h-[40vh] overflow-y-auto">
            {shown.map((l) => (
              <li key={l.href}>
                <Link href={l.href} role="menuitem" onClick={() => setLeavesFor(null)} className="block rounded-xl px-3 py-2.5 font-sans text-[17px] text-ink active:bg-paper-deep">
                  {l.label}
                </Link>
              </li>
            ))}
            {leaves.length > LEAVES_VISIBLE && !moreOpen ? (
              <li>
                <button type="button" onClick={() => setMoreOpen(true)} className="block w-full rounded-xl px-3 py-2.5 text-left font-sans text-[15px] text-clay active:bg-paper-deep">
                  more · {leaves.length - LEAVES_VISIBLE}
                </button>
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}

      {open ? (
        <nav aria-label="Verbs" className="pointer-events-auto mx-1 flex h-11 items-stretch justify-between px-1">
          {verbs.map((v) => {
            const href = resolveHouseHref(v.href, houseSlug);
            if (!href) return null;
            const isActive = active?.key === v.key;
            const hasLeaves = v.leaves.length > 0;
            return (
              <button
                key={v.key}
                type="button"
                data-verb={v.key}
                aria-current={isActive ? "page" : undefined}
                onClick={() => {
                  // Second tap on the verb you are in → its leaves.
                  if (isActive && hasLeaves) { setLeavesFor(leavesVerb?.key === v.key ? null : v.key); return; }
                  setLeavesFor(null);
                  router.push(href);
                }}
                className={
                  "flex-1 truncate px-1 font-sans text-[15px] leading-none active:opacity-60 " +
                  (isActive ? "text-ink font-semibold" : "text-ink-soft")
                }
              >
                {v.label}
              </button>
            );
          })}
        </nav>
      ) : null}

      <button
        type="button"
        aria-label={open ? "Hide verbs" : "Show verbs"}
        aria-expanded={open}
        onClick={() => { setManual(!open); if (open) setLeavesFor(null); }}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        className="pointer-events-auto mx-auto flex h-6 w-24 items-center justify-center"
        data-dock-grip
      >
        <span className="block h-1 w-9 rounded-full bg-ink/40" />
      </button>
    </div>
  );
}
