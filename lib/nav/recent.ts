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

export function touchRecent(pathname: string): RecentMap {
  if (typeof window === "undefined" || !pathname) return {};
  const cur = readRecent();
  cur[pathname] = Date.now();
  const entries = Object.entries(cur).sort((a, b) => b[1] - a[1]).slice(0, MAX);
  const next: RecentMap = Object.fromEntries(entries);
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch {}
  return next;
}

// Leaves visited (by path, query ignored) first, most recent first; the rest
// in authored order. Stable and pure so the desktop rail and the phone dock
// agree.
export function orderByRecent<T extends { href: string }>(leaves: T[], recent: RecentMap): T[] {
  const pathOf = (h: string) => h.split("?")[0];
  const stamp = (l: T) => recent[pathOf(l.href)] || 0;
  const seen = leaves.filter((l) => stamp(l) > 0).sort((a, b) => stamp(b) - stamp(a));
  const rest = leaves.filter((l) => stamp(l) === 0);
  return [...seen, ...rest];
}
