"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo } from "react";
import { scopeForUrl, resolveScope, type Scope } from "@/lib/scope";
import {
  HOUSE_ROOMS, HOUSE_ROOM_LABEL, HOUSE_ROOM_LEGACY_PATH,
  houseNameForSlug, type HouseSlug,
} from "@/lib/houses";

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
  if (entity === "bistro_mondo") return "bm";
  if (entity === "taller") return "taller";
  return null;
}

export default function RoomSwitcher({ compact = false }: { compact?: boolean }) {
  const path = usePathname() || "";

  const scope: Scope | null = useMemo(() => {
    const s = scopeForUrl(path);
    if (s) return s;
    return resolveScope(path, entityCookieToHouseSlug(readEntityCookieClient()));
  }, [path]);

  // Persist current room for legacy readers. Hook runs on every render;
  // no-ops when the scope isn't room-level.
  useEffect(() => {
    if (scope && scope.level === "room") writeRoomCookie(scope.room);
  }, [scope]);

  // Studio scope → hide. Rooms belong to a house.
  if (!scope || scope.level === "studio") return null;

  const houseSlug: HouseSlug = scope.houseSlug;
  const activeRoom = scope.level === "room" ? scope.room : "overview";

  const chips: Array<{ key: string; label: string; href: string }> = [
    { key: "overview", label: "Overview", href: `/h/${houseSlug}` },
    ...HOUSE_ROOMS.map((r) => ({
      key: r,
      label: HOUSE_ROOM_LABEL[r],
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
