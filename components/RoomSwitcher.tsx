"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { scopeForUrl, resolveScope, type Scope } from "@/lib/scope";
import {
  HOUSE_ROOMS, HOUSE_ROOM_LABEL, HOUSE_ROOM_LEGACY_PATH,
  houseNameForSlug, type HouseSlug,
} from "@/lib/houses";
import { E_BM, E_TALLER, type EntityKey } from "@/lib/entities";
import { onCtx } from "@/lib/ctx";
import { t, type Lang } from "@/lib/i18n";

// RoomSwitcher — Push 1 (2026-08-23), rebuilt for the three-level scope
// (2026-08-31 Boris walk).
//
// This is the chip strip near the top-right that lets the user move between
// the ROOMS OF A HOUSE. The critical fix: rooms only exist INSIDE a house.
// The old strip rendered `Studio · Kitchen · Dining · Office` as siblings,
// which made "Kitchen" address-less (which house's kitchen?). The new strip:
//
//   • Studio scope    — HIDDEN. Rooms don't exist at portfolio level.
//   • House scope     — `Overview · Kitchen · Dining Room · Office`.
//                       Overview is the house dashboard itself; the three
//                       rooms navigate to /h/<slug>/<room>.
//   • Room scope      — same as house, current room highlighted.
//
// Selection persists via the fs_room cookie for downstream compatibility
// (some legacy dashboards read it) but the source of truth is the URL.

function writeRoomCookie(room: string) {
  try {
    document.cookie = `fs_room=${room}; path=/; max-age=31536000; samesite=lax`;
    localStorage.setItem("fs_room", room);
  } catch {}
}

// Read fs_entity cookie on the client. RoomSwitcher can be rendered on a
// legacy path where scopeForUrl returns null; in that case we fall back to
// the entity cookie to derive a house.
function readEntityCookieClient(): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(/(?:^|;\s*)fs_entity=([^;]+)/);
  return m?.[1] ? decodeURIComponent(m[1]) : null;
}
function entityCookieToHouseSlug(entity: string | null): HouseSlug | null {
  if (entity === E_BM) return "bm";
  if (entity === E_TALLER) return "taller";
  return null;
}

export default function RoomSwitcher({
  compact = false,
  initialEntity = null,
  lang,
}: { compact?: boolean; initialEntity?: EntityKey | null; lang?: Lang }) {
  const path = usePathname() || "";

  // HYDRATION (2026-09-24, React #418/#423 on /boh, /office, /execute/*):
  // on legacy cookie-scoped paths scopeForUrl() is null and the scope came
  // from readEntityCookieClient(), which reads document.cookie — null on the
  // server, so SSR rendered NOTHING here while the first client render (cookie
  // present) rendered the chip strip. Two instances per page (desktop + mobile
  // rows in AppChrome) → #418 x2-3 + one #423 recovery per hard load; on a
  // slow mobile load the recovery escalated to #329 and the shell (incl. Chef)
  // never mounted. /h/<slug>/** never warned because the URL alone resolves.
  // Fix: seed from the SERVER-resolved entity (layout.tsx → AppChrome) so both
  // renders agree; re-read the cookie only after mount (switcher changes).
  const [entity, setEntity] = useState<string | null>(initialEntity);
  useEffect(() => {
    const read = () => { const c = readEntityCookieClient(); if (c) setEntity(c); };
    read();
    return onCtx(read);
  }, []);

  const scope: Scope | null = useMemo(() => {
    const s = scopeForUrl(path);
    if (s) return s;
    return resolveScope(path, entityCookieToHouseSlug(entity));
  }, [path, entity]);

  // Persist current room for legacy readers. Hook runs on every render;
  // no-ops when the scope isn't room-level.
  useEffect(() => {
    if (scope && scope.level === "room") writeRoomCookie(scope.room);
  }, [scope]);

  // Studio scope → hide. Rooms belong to a house.
  if (!scope || scope.level === "studio") return null;

  const houseSlug: HouseSlug = scope.houseSlug;
  const activeRoom = scope.level === "room" ? scope.room : "overview";

  // Runway d2 (2026-09-20): chip labels run through t() so the Amsterdam
  // launch can flip to Dutch (Overzicht / Keuken / Restaurant / Kantoor)
  // via the fs_lang cookie. Falls back to English when there's no key.
  // `lang` is threaded from the server (serverLang() in layout.tsx): the bare
  // t() reads the cookie from document, which SSR cannot see, so an es/nl
  // user got English chips from the server and Spanish/Dutch on the client —
  // a text mismatch on every legacy page. Same-language on both sides now.
  const roomKey: Record<string, string> = {
    kitchen: "rooms.kitchen",
    dining: "rooms.dining",
    office: "rooms.office",
  };
  const chips: Array<{ key: string; label: string; href: string }> = [
    { key: "overview", label: t("rooms.overview", lang), href: `/h/${houseSlug}` },
    ...HOUSE_ROOMS.map((r) => ({
      key: r,
      label: t(roomKey[r] || "", lang) || HOUSE_ROOM_LABEL[r],
      href: `/h/${houseSlug}/${r}`,
    })),
  ];

  return (
    <div
      className={
        "flex items-center gap-1 rounded-full border border-black/10 " +
        (compact ? "px-1 py-0.5" : "px-1.5 py-1")
      }
      role="group"
      aria-label={`Room switcher — ${houseNameForSlug(houseSlug)}`}
    >
      {chips.map((c) => {
        const isActive = activeRoom === c.key;
        return (
          <Link
            key={c.key}
            href={c.href}
            onClick={() => { if (c.key !== "overview") writeRoomCookie(c.key); }}
            className={
              "rounded-full px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wide transition " +
              (isActive
                ? "bg-ink text-paper"
                : "text-clay hover:text-ink")
            }
            aria-current={isActive ? "page" : undefined}
          >
            {c.label}
          </Link>
        );
      })}
    </div>
  );
}
