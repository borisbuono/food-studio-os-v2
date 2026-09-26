"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { isPrimaryEntity } from "@/lib/entities";
import { setEntity as setEntityCtx, readEntityCookie } from "@/lib/ctx";
import { scopeForUrl, itemsForHouse } from "@/lib/scope";
import { flattenNav } from "@/lib/nav";
import { fetchMyAccess, type MyAccess } from "@/lib/access/myAccess";
import {
  paletteAccessFor, canSeeRoute, isOperating, NO_ACCESS,
  type RouteGate, type PaletteAccess,
} from "@/lib/access/tenantScope";
import { PILLAR_LABEL, PILLAR_ACCENT, Pillar } from "@/lib/routing/pillar-map";
import type { ServerProfile } from "@/lib/serverProfile";
import { Z } from "@/lib/ui/z";

// P0 fix (2026-09-21) — Boris caught the palette rendering for anonymous
// visitors on /welcome, exposing every internal route (FOH, dashboard,
// bookings, guests, etc.) before the visitor had signed in. Two gates:
//   1. Route gate — never mount on public routes (/welcome, /login, /auth/*,
//      /m/*, /booking-terms, /onboard/*). Same list AppChrome uses to hide
//      the sidebar + topbar.
//   2. Session gate — even on a private route, refuse to render (and skip
//      registering the ⌘K keyboard listener) unless the SSR profile is
//      present. `initialProfile` is threaded from app/layout.tsx via
//      serverProfile() so this decision holds on FIRST PAINT (per the SSR
//      guest flicker precedent — #418/#423).
// 3. Membership gate (2026-09-21, Studio + House chrome polish) — even for a
//    signed-in user, every route carries a RouteGate (room + optional entity
//    feature). The palette shows only routes the user's memberships open for
//    the house in scope AND the house has switched on (entities.foh_enabled /
//    entities.bookings_enabled). Access loads from /api/my-memberships; until
//    it resolves only universal routes show (fail closed).
const PUBLIC_PREFIXES = ["/welcome", "/login", "/auth/", "/m/", "/booking-terms", "/onboard", "/apply/"];
function isPublic(path: string): boolean {
  return PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(p));
}

// Command palette — ⌘K / Ctrl+K on any breakpoint. Extended for desktop:
// slash commands, fuzzy search, keyboard navigation, recent history,
// voice input via the existing Assistant FAB pipeline (dispatchEvent hook).
//
// Tiny footprint: this is a self-contained component. No new deps. Persists
// recents in localStorage. When triggered from another surface, dispatch
// `fs:cmdk:open` (with optional `detail.query`) on window.

const RECENT_KEY = "fs_cmdk_recent_v1";
const RECENT_LIMIT = 8;

type Route = { label: string; href: string; hint: string; pillar?: Pillar; gate?: RouteGate; verb?: string };

// Slim OS slice 1 (2026-09-26): the palette lists SURVIVING screens only,
// grouped by verb — the same model the rail and the dock render (lib/nav.ts).
// House verbs first, then Studio, then /me. Rows are "Verb · Leaf"; the verb
// screen itself is the bare verb. Nothing here may point at a retired route
// (scripts/verify_nav.mjs checks).
const ROUTES: Route[] = ([
  ...flattenNav("house").map((r) => ({ label: r.label, href: r.href, hint: r.hint || "", gate: r.gate, verb: r.verb })),
  ...flattenNav("studio").map((r) => ({ label: "Studio · " + r.label, href: r.href, hint: r.hint || "", gate: r.gate, verb: r.verb })),
  ...flattenNav("me").map((r) => ({ label: "Me · " + r.label, href: r.href, hint: r.hint || "", gate: r.gate, verb: r.verb })),
  { label: "Home", href: "/", hint: "root landing", verb: "home" },
  { label: "Studio", href: "/studio", hint: "food studios portfolio group", gate: { room: "studio" }, verb: "studio" },
] as Route[]).filter((r, i, all) => all.findIndex((x) => x.href === r.href) === i);

// Fuzzy scoring — cheap: token overlap + prefix boost. Not perfect but
// enough for a ~90-row palette.
function score(query: string, r: Route): number {
  if (!query) return 0;
  const q = query.toLowerCase();
  const hay = (r.label + " " + r.hint + " " + r.href).toLowerCase();
  if (hay.startsWith(q)) return 100;
  if (hay.includes(q)) return 60;
  const tokens = q.split(/\s+/).filter(Boolean);
  let s = 0;
  for (const t of tokens) if (hay.includes(t)) s += 10;
  return s;
}

type Mode =
  | { kind: "search"; query: string }
  | { kind: "entity" }
  | { kind: "help" }
  | { kind: "goto"; query: string }
  | { kind: "new" }
  ;

const HELP_LINES: { cmd: string; desc: string }[] = [
  { cmd: "/goto <query>", desc: "Jump to a page (fuzzy match)" },
  { cmd: "/entity",       desc: "Switch the active entity" },
  { cmd: "/search <q>",   desc: "Fuzzy search all routes (same as typing)" },
  { cmd: "/new",          desc: "Create something new (invoice, event, recipe…)" },
  { cmd: "/help",         desc: "Show this hint" },
  { cmd: "⌘K / Ctrl+K",   desc: "Open or toggle this palette" },
  { cmd: "↑ ↓",           desc: "Move highlight" },
  { cmd: "⏎",             desc: "Accept" },
  { cmd: "esc",           desc: "Close" },
  { cmd: "voice mic",     desc: "Say a route name; palette lands you on it" },
];

const NEW_ITEMS: Route[] = [
  { label: "New · booking",       href: "/execute/bookings",               hint: "reservation", gate: { room: "dining", feature: "bookings" } },
  { label: "New · event",         href: "/administrate/events/new",        hint: "private dining", gate: { room: "office" } },
  { label: "New · commercial",    href: "/grow/commercials/new",           hint: "deal contract", gate: { room: "office" } },
  { label: "New · relationship",  href: "/grow/relationships/new",         hint: "crm lead", gate: { room: "dining", feature: "foh" } },
  { label: "New · recipe import", href: "/develop/recipes/import",         hint: "paste url", gate: { room: "kitchen" } },
  { label: "New · team invite",   href: "/administrate/team/invite",       hint: "invite whatsapp", gate: { room: "office" } },
  { label: "New · hiring opening", href: "/h/{house}/office/hiring/new",   hint: "open role recruit", gate: { room: "office", feature: "hiring" } },
  { label: "New · order",         href: "/execute/orders",                 hint: "supplier order", gate: { room: "kitchen" } },
  // "New · campaign" → /grow/reach/campaigns/new dropped 2026-09-26: the
  // composer was never built (see lib/integrations/marketing/wix-newsletter.ts).
];

function parseMode(input: string): Mode {
  const t = input.trimStart();
  if (t.startsWith("/entity")) return { kind: "entity" };
  if (t.startsWith("/help"))   return { kind: "help" };
  if (t.startsWith("/new"))    return { kind: "new" };
  if (t.startsWith("/goto"))   return { kind: "goto",   query: t.slice(5).trim() };
  if (t.startsWith("/search")) return { kind: "search", query: t.slice(7).trim() };
  return { kind: "search", query: t };
}

function readRecents(): string[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); } catch { return []; }
}
function pushRecent(href: string) {
  if (typeof window === "undefined") return;
  try {
    const cur = readRecents().filter((h) => h !== href);
    cur.unshift(href);
    localStorage.setItem(RECENT_KEY, JSON.stringify(cur.slice(0, RECENT_LIMIT)));
  } catch {}
}

export default function CommandK({ initialProfile }: { initialProfile?: ServerProfile | null }) {
  const router = useRouter();
  const path = usePathname() || "/";
  // Gate: only mount the palette (chip + modal + ⌘K listener) when the SSR
  // profile resolved AND we're on a private route. On /welcome, /login, etc.
  // the palette must NEVER render — an anonymous visitor should not see the
  // internal route list.
  const enabled = initialProfile != null && !isPublic(path);

  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const [recents, setRecents] = useState<string[]>([]);
  const [listening, setListening] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const mode = useMemo(() => parseMode(q), [q]);

  // Membership + tenant access (fail closed until loaded).
  const [myAccess, setMyAccess] = useState<MyAccess | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    fetchMyAccess().then((a) => { if (live) setMyAccess(a); });
    return () => { live = false; };
  }, [enabled]);

  // The house in scope: /h/<slug> → that house; /studio → none (portfolio);
  // a legacy path → the fs_entity cookie. Recomputed when the palette opens
  // so a cookie swap since the last open is honoured.
  const { access, houseSlug } = useMemo<{ access: PaletteAccess; houseSlug: string | null }>(() => {
    if (!myAccess) return { access: NO_ACCESS, houseSlug: null };
    const sc = scopeForUrl(path);
    let ctxId: string | null = null;
    if (sc && sc.level !== "studio") {
      ctxId = myAccess.entities.find((e) => e.slug === sc.houseSlug)?.id ?? null;
    } else if (!sc) {
      ctxId = readEntityCookie();
    }
    // The slug of the house in scope — fills "{house}" in URL-scoped hrefs.
    const houseSlug = ctxId ? (myAccess.entities.find((e) => e.id === ctxId)?.slug ?? null) : null;
    return { access: paletteAccessFor(myAccess.entities, myAccess.memberships, ctxId), houseSlug };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myAccess, path, open]);

  const allowedRoutes = useMemo(
    () => itemsForHouse(ROUTES.filter((r) => canSeeRoute(r.gate || {}, access)), houseSlug),
    [access, houseSlug],
  );
  const allowedNew = useMemo(
    () => itemsForHouse(NEW_ITEMS.filter((r) => canSeeRoute(r.gate || {}, access)), houseSlug),
    [access, houseSlug],
  );

  // Keyboard opener + external dispatch. Voice / FAB integration invokes this.
  // The listener is only attached when `enabled` — an anonymous visitor
  // pressing ⌘K on /welcome hits nothing.
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault(); setOpen((o) => !o);
      }
      if (e.key === "Escape" && open) { setOpen(false); }
    };
    const onOpen = (e: any) => {
      setOpen(true);
      const qv = e?.detail?.query;
      if (typeof qv === "string") setQ(qv);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("fs:cmdk:open", onOpen as any);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("fs:cmdk:open", onOpen as any);
    };
  }, [enabled, open]);

  useEffect(() => {
    if (open) {
      setRecents(readRecents());
      setCursor(0);
      // focus after paint
      setTimeout(() => inputRef.current?.focus(), 20);
    } else {
      setQ("");
      stopVoice();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const searchResults = useMemo<Route[]>(() => {
    const query =
      mode.kind === "search" ? mode.query :
      mode.kind === "goto"   ? mode.query :
      "";
    if (!query) return allowedRoutes.slice(0, 15);
    return allowedRoutes
      .map((r) => ({ r, s: score(query, r) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 12)
      .map((x) => x.r);
  }, [mode, allowedRoutes]);

  const rows = useMemo<{ href?: string; label: string; hint?: string; onSelect?: () => void; pillar?: Pillar }[]>(() => {
    if (mode.kind === "entity") {
      // Only houses this user belongs to (tenant filter), plus the Studio
      // for owners. Picking one lands on that house's own URL scope.
      const houses = (myAccess?.entities || [])
        .filter((e) => isOperating(e.entity_type) && e.status === "active" && e.slug);
      const out: { href?: string; label: string; hint?: string; onSelect?: () => void }[] = houses.map((e) => ({
        label: "House → " + e.name,
        hint: e.slug || "",
        href: "/h/" + e.slug,
        onSelect: () => { if (isPrimaryEntity(e.id)) setEntityCtx(e.id); },
      }));
      if (access.rooms.has("studio")) {
        out.unshift({ label: "Studio → Food Studios", hint: "portfolio", href: "/studio" });
      }
      return out;
    }
    if (mode.kind === "help") {
      return HELP_LINES.map((h) => ({ label: h.cmd + "  —  " + h.desc, onSelect: () => {} }));
    }
    if (mode.kind === "new") {
      const list = mode as any;
      const qq = (list.query || "").toLowerCase();
      const filtered = allowedNew.filter((n) => n.label.toLowerCase().includes(qq));
      return (filtered.length ? filtered : allowedNew).map((n) => ({ href: n.href, label: n.label, hint: n.hint }));
    }
    const base = searchResults.map((r) => ({ href: r.href, label: r.label, hint: r.hint, pillar: r.pillar }));
    // If no query, surface recents at top.
    if ((mode.kind === "search" && !mode.query) && recents.length) {
      const recentRows = recents
        .map((h) => allowedRoutes.find((r) => r.href === h))
        .filter(Boolean)
        .slice(0, 5)
        .map((r: any) => ({ href: r.href, label: "Recent · " + r.label, hint: r.hint, pillar: r.pillar as Pillar }));
      return [...recentRows, ...base].slice(0, 18);
    }
    return base;
  }, [mode, searchResults, recents, myAccess, access, allowedRoutes, allowedNew]);

  const clampedCursor = Math.min(cursor, Math.max(0, rows.length - 1));

  const accept = (i: number) => {
    const row = rows[i];
    if (!row) return;
    if (row.onSelect) row.onSelect();
    if (row.href) {
      pushRecent(row.href);
      setOpen(false);
      router.push(row.href);
    }
  };

  // Voice input — uses Web Speech API directly with the same-mic guarantees as
  // the old Chef FAB. Landing on a route works when the utterance matches a routes
  // label/hint; otherwise the transcript is filled into the query field so the
  // fuzzy match takes over.
  const recRef = useRef<any>(null);
  function startVoice() {
    const w: any = typeof window !== "undefined" ? window : {};
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) return;
    try {
      const rec = new SR();
      rec.continuous = false;
      rec.interimResults = true;
      rec.lang = (typeof navigator !== "undefined" && navigator.language) || "en-US";
      rec.onresult = (evt: any) => {
        let text = "";
        for (let i = evt.resultIndex; i < evt.results.length; i++) {
          text += evt.results[i][0].transcript;
        }
        setQ(text.trim());
      };
      rec.onend = () => setListening(false);
      rec.onerror = () => setListening(false);
      rec.start();
      recRef.current = rec;
      setListening(true);
    } catch {
      setListening(false);
    }
  }
  function stopVoice() {
    try { recRef.current?.stop?.(); } catch {}
    recRef.current = null;
    setListening(false);
  }

  // Nothing renders — no chip, no ⌘K label, no modal — for unauth visitors
  // or public routes. Keeps the internal route inventory off the marketing
  // shell entirely (both DOM and initial HTML).
  if (!enabled) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wide text-clay hover:text-ink-soft"
        aria-label="Open command palette"
      >
        search
        <span className="hidden md:inline rounded border border-black/15 bg-paper-deep px-1 font-mono text-[9px] uppercase text-clay">⌘K</span>
      </button>

      {open ? (
        <div
          className="fixed inset-0 flex items-start justify-center bg-black/25 px-4 pt-24"
          style={{ zIndex: Z.modal }}
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Command palette"
        >
          <div
            className="w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center border-b border-black/10 px-3 py-2">
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none" className="text-clay">
                <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.4" />
                <path d="M14 14l3.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => { setQ(e.target.value); setCursor(0); }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, rows.length - 1)); }
                  if (e.key === "ArrowUp")   { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
                  if (e.key === "Enter")     { e.preventDefault(); accept(clampedCursor); }
                  if (e.key === "Escape")    { e.preventDefault(); setOpen(false); }
                }}
                placeholder="Search, or type / for commands"
                className="w-full bg-transparent px-2 py-1 font-sans text-[15px] text-ink outline-none"
              />
              <button
                onClick={() => (listening ? stopVoice() : startVoice())}
                className={"ml-2 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase " + (listening ? "border-ember text-ember" : "border-black/10 text-clay hover:text-ink")}
                aria-label={listening ? "Stop voice" : "Start voice"}
              >
                {listening ? "● listening" : " voice"}
              </button>
              <span className="ml-2 rounded border border-black/15 bg-paper-deep px-1 font-mono text-[9px] uppercase text-clay">esc</span>
            </div>

            {mode.kind !== "search" || mode.query ? (
              <div className="border-b border-black/5 px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-clay">
                {mode.kind === "search" ? "Search results" :
                 mode.kind === "goto"   ? "Go to" :
                 mode.kind === "entity" ? "Switch entity" :
                 mode.kind === "help"   ? "Palette help" :
                 mode.kind === "new"    ? "Create new…" : ""}
              </div>
            ) : null}

            <ul className="max-h-80 overflow-y-auto py-1" role="listbox">
              {rows.map((row, i) => {
                const active = i === clampedCursor;
                return (
                  <li key={(row.href || row.label) + ":" + i}>
                    <button
                      onMouseEnter={() => setCursor(i)}
                      onClick={() => accept(i)}
                      className={
                        "flex w-full items-center justify-between px-3 py-2 text-left font-sans text-[13.5px] " +
                        (active ? "bg-paper text-ink" : "text-ink-soft hover:bg-paper hover:text-ink")
                      }
                      role="option"
                      aria-selected={active}
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        {row.pillar ? (
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ background: PILLAR_ACCENT[row.pillar] }}
                            title={PILLAR_LABEL[row.pillar]}
                            aria-hidden
                          />
                        ) : (
                          <span className="h-2 w-2 shrink-0 rounded-full bg-clay/30" aria-hidden />
                        )}
                        <span className="truncate">{row.label}</span>
                      </span>
                      <span className="ml-3 flex items-center gap-2">
                        {row.hint ? <span className="font-mono text-[10px] uppercase text-clay truncate">{row.hint}</span> : null}
                        {active ? <span className="rounded border border-black/15 bg-paper-deep px-1 font-mono text-[9px] uppercase text-clay">⏎</span> : null}
                      </span>
                    </button>
                  </li>
                );
              })}
              {!rows.length ? (
                <li>
                  <p className="px-3 py-4 font-serif italic text-[13.5px] text-clay">
                    No matches. Try /help for commands.
                  </p>
                </li>
              ) : null}
            </ul>

            <div className="flex items-center justify-between border-t border-black/5 bg-paper-deep/60 px-3 py-1.5 font-mono text-[10px] uppercase text-clay">
              <span className="flex items-center gap-2">
                <span className="rounded border border-black/15 bg-paper px-1">↑↓</span>
                move
                <span className="rounded border border-black/15 bg-paper px-1">⏎</span>
                accept
                <span className="rounded border border-black/15 bg-paper px-1">esc</span>
                close
              </span>
              <span className="hidden md:inline">/entity  /new  /help</span>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
