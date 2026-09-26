// recent.ts — personal recent-use ordering for a verb's leaves.
//
// Structure is fixed; only leaf ORDER is personal (critic, Direction A). The
// simplest thing that works: a localStorage map href → last-visited epoch ms,
// written on every route change by whoever renders the nav. No server round
// trip, no table. Untouched leaves keep their authored order under "more".

const KEY = "fs_nav_recent_v1";
const MAX = 80;

export type RecentMap = Record<string, number>;

export function readRecent(): RecentMap {
  if (typeof window === "undefined") return {};
  try { const v = JSON.parse(localStorage.getItem(KEY) || "{}"); return v && typeof v === "object" ? v : {}; } catch { return {}; }
}

// Slices 2–4 (2026-09-26) fold sibling screens into `?tab=` on a survivor, so
// a leaf's identity is path + tab. The key keeps only that one param.
export function recentKey(href: string): string {
  const [path, q] = href.split("?");
  const tab = q ? new URLSearchParams(q).get("tab") : null;
  return tab ? `${path}?tab=${tab}` : path;
}

export function touchRecent(pathname: string): RecentMap {
  if (typeof window === "undefined" || !pathname) return {};
  const cur = readRecent();
  cur[pathname] = Date.now();
  const tab = new URLSearchParams(window.location.search || "").get("tab");
  if (tab) cur[`${pathname}?tab=${tab}`] = Date.now();
  const entries = Object.entries(cur).sort((a, b) => b[1] - a[1]).slice(0, MAX);
  const next: RecentMap = Object.fromEntries(entries);
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch {}
  return next;
}

// Leaves visited (by path + tab) first, most recent first; the rest
// in authored order. Stable and pure so the desktop rail and the phone dock
// agree.
export function orderByRecent<T extends { href: string }>(leaves: T[], recent: RecentMap): T[] {
  const stamp = (l: T) => recent[recentKey(l.href)] || 0;
  const seen = leaves.filter((l) => stamp(l) > 0).sort((a, b) => stamp(b) - stamp(a));
  const rest = leaves.filter((l) => stamp(l) === 0);
  return [...seen, ...rest];
}
