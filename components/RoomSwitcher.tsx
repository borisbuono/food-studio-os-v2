"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

// RoomSwitcher — Push 1 (2026-08-23).
//
// A small chip cluster near the entity switcher that lets owners + multi-role
// users move between the four rooms of a house:
//
//    Studio · Kitchen · Dining Room · Office
//
// The selection persists in the `fs_room` cookie / localStorage so the shell
// remembers the user's last room across navigations. Clicking a room
// navigates to that room's canonical route (kitchen → /boh, dining → /foh,
// office → /office, studio → /studio) — the underlying routes stay untouched.

const ROOMS: { key: "studio" | "kitchen" | "dining" | "office"; label: string; href: string }[] = [
  { key: "studio",  label: "Studio",      href: "/studio" },
  { key: "kitchen", label: "Kitchen",     href: "/boh" },
  { key: "dining",  label: "Dining Room", href: "/foh" },
  { key: "office",  label: "Office",      href: "/office" },
];

function activeRoomForPath(path: string): string {
  if (path.startsWith("/studio")) return "studio";
  if (path.startsWith("/boh")) return "kitchen";
  if (path.startsWith("/foh")) return "dining";
  if (path.startsWith("/office") || path.startsWith("/administrate")) return "office";
  return "";
}

function writeRoomCookie(room: string) {
  try {
    document.cookie = `fs_room=${room}; path=/; max-age=31536000; samesite=lax`;
    localStorage.setItem("fs_room", room);
  } catch {}
}

export default function RoomSwitcher({
  rooms,
  compact = false,
}: {
  rooms?: Array<"studio" | "kitchen" | "dining" | "office">;
  compact?: boolean;
}) {
  const path = usePathname() || "";
  const active = activeRoomForPath(path);
  const visible = rooms && rooms.length
    ? ROOMS.filter((r) => rooms!.includes(r.key))
    : ROOMS;

  useEffect(() => {
    if (active) writeRoomCookie(active);
  }, [active]);

  // No rooms to switch between? Render nothing (a single-room user shouldn't
  // see this at all; the sidebar / topbar decides whether to mount us).
  if (visible.length < 2) return null;

  return (
    <div
      className={
        "flex items-center gap-1 rounded-full border border-black/10 " +
        (compact ? "px-1 py-0.5" : "px-1.5 py-1")
      }
      role="group"
      aria-label="Room switcher"
    >
      {visible.map((r) => {
        const isActive = active === r.key;
        return (
          <Link
            key={r.key}
            href={r.href}
            onClick={() => writeRoomCookie(r.key)}
            className={
              "rounded-full px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wide transition " +
              (isActive
                ? "bg-ink text-paper"
                : "text-clay hover:text-ink")
            }
            aria-current={isActive ? "page" : undefined}
          >
            {r.label}
          </Link>
        );
      })}
    </div>
  );
}
