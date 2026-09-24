"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { isPrimaryEntity } from "@/lib/entities";
import { setEntity as setEntityCtx, readEntityCookie } from "@/lib/ctx";
import { scopeForUrl, itemsForHouse } from "@/lib/scope";
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

type Route = { label: string; href: string; hint: string; pillar?: Pillar; gate?: RouteGate };

const ROUTES: Route[] = [
  // FOH
  { label: "FOH · dashboard",         href: "/foh",                    hint: "front of house today", pillar: "foh", gate: { room: "dining", feature: "foh" } },
  { label: "FOH · bookings",          href: "/foh/bookings",           hint: "reservations covers", pillar: "foh", gate: { room: "dining", feature: "bookings" } },
  { label: "FOH · the pass",          href: "/foh/pass",               hint: "service pass", pillar: "foh", gate: { room: "dining", feature: "foh" } },
  { label: "FOH · menu (consumer)",   href: "/foh/menu",               hint: "guest menu list", pillar: "foh", gate: { room: "dining", feature: "foh" } },
  { label: "FOH · guests",            href: "/foh/guests",             hint: "guest arc profile", pillar: "foh", gate: { room: "dining", feature: "foh" } },
  { label: "FOH · reviews",           href: "/foh/reviews",            hint: "reputation reviews", pillar: "foh", gate: { room: "dining", feature: "foh" } },
  { label: "FOH · academy",           href: "/foh/academy",            hint: "service training", pillar: "foh", gate: { room: "dining", feature: "academy" } },
  { label: "Guest surface",           href: "/m",                      hint: "public menu m/", pillar: "foh", gate: { room: "dining", feature: "foh" } },
  { label: "Relationships",           href: "/grow/relationships",     hint: "CRM leads", pillar: "foh", gate: { room: "dining", feature: "foh" } },
  { label: "Reputation",              href: "/grow/reputation",        hint: "ratings stars", pillar: "foh", gate: { room: "dining", feature: "foh" } },
  { label: "Guest inbox",             href: "/grow/inbox",             hint: "inbound messages", pillar: "foh", gate: { room: "dining", feature: "foh" } },

  // BOH
  { label: "BOH · dashboard",         href: "/boh",                    hint: "kitchen today", pillar: "boh", gate: { room: "kitchen" } },
  { label: "BOH · cook mode",         href: "/boh/cook",               hint: "cook mode step-by-step", pillar: "boh", gate: { room: "kitchen" } },
  { label: "BOH · MEP",               href: "/boh/mep",                hint: "mise en place prep", pillar: "boh", gate: { room: "kitchen" } },
  { label: "BOH · menu",              href: "/boh/menu",               hint: "kitchen menu list", pillar: "boh", gate: { room: "kitchen" } },
  { label: "BOH · recipes",           href: "/boh/recipes",            hint: "recipe cards", pillar: "boh", gate: { room: "kitchen" } },
  { label: "BOH · receiving",         href: "/boh/receiving",          hint: "delivery-note intake", pillar: "boh", gate: { room: "kitchen" } },
  { label: "BOH · wine",              href: "/boh/wine",               hint: "wine list bottle bar", pillar: "boh", gate: { room: "kitchen" } },
  { label: "BOH · bar",               href: "/boh/bar",                hint: "cocktail bar", pillar: "boh", gate: { room: "kitchen" } },
  { label: "BOH · academy",           href: "/boh/academy",            hint: "kitchen training", pillar: "boh", gate: { room: "kitchen", feature: "academy" } },
  { label: "Develop menu",            href: "/develop/menu",           hint: "recipes list r&d", pillar: "boh", gate: { room: "kitchen" } },
  { label: "Menu engineering",        href: "/develop/menu-engineering", hint: "star dog puzzle", pillar: "boh", gate: { room: "office" } },
  { label: "Repricing",               href: "/develop/repricing",      hint: "menu prices update", pillar: "boh", gate: { room: "office" } },
  { label: "Lexicon",                 href: "/develop/lexicon",        hint: "menu language taxonomy", pillar: "boh", gate: { room: "kitchen" } },
  { label: "Inventory",               href: "/execute/inventory",      hint: "stock count", pillar: "boh", gate: { room: "kitchen" } },
  { label: "Place an order",          href: "/execute/orders",         hint: "supplier order", pillar: "boh", gate: { room: "kitchen" } },
  { label: "Temps · HACCP",           href: "/execute/temp",           hint: "temperature log", pillar: "boh", gate: { room: "kitchen" } },
  { label: "Handover",                href: "/execute/handover",       hint: "shift handover", pillar: "boh", gate: { room: "kitchen" } },

  // Office
  { label: "Office · dashboard",      href: "/office",                 hint: "operator ledger", pillar: "office", gate: { room: "office" } },
  { label: "Finance",                 href: "/administrate/finance",   hint: "money", pillar: "office", gate: { room: "office" } },
  { label: "Reconciliation",          href: "/administrate/finance/reconciliation", hint: "bank match unmatched", pillar: "office", gate: { room: "office" } },
  { label: "Anomalies",               href: "/administrate/finance/anomalies", hint: "finance triage", pillar: "office", gate: { room: "office" } },
  { label: "Scan queue",              href: "/administrate/finance/scans", hint: "Holded scan inbox", pillar: "office", gate: { room: "office" } },
  { label: "EOD reports",             href: "/administrate/finance/eod", hint: "end of day close cash", pillar: "office", gate: { room: "office" } },
  { label: "Missing invoices",        href: "/administrate/invoices",  hint: "supplier docs", pillar: "office", gate: { room: "office" } },
  { label: "Suppliers",               href: "/administrate/suppliers", hint: "vendors", pillar: "office", gate: { room: "office" } },
  { label: "Team",                    href: "/administrate/team",      hint: "people roster", pillar: "office", gate: { room: "office" } },
  // "{house}" → the house in scope (lib/scope.ts itemsForHouse); the row is
  // dropped when no house resolves. /administrate/hiring never existed as a
  // page — the board lives at /h/<slug>/office/hiring (fixed 2026-09-22).
  { label: "Hiring · pipeline",       href: "/h/{house}/office/hiring", hint: "hr funnel candidates openings", pillar: "office", gate: { room: "office", feature: "hiring" } },
  { label: "Schedule",                href: "/administrate/team/schedule", hint: "shifts rota", pillar: "office", gate: { room: "office" } },
  { label: "Calendar",                href: "/h/{house}/calendar",     hint: "house calendar shifts bookings prep", pillar: "office", gate: { room: "office" } },
  { label: "Events",                  href: "/administrate/events",    hint: "private dining", pillar: "office", gate: { room: "office" } },
  { label: "Decisions",               href: "/administrate/decisions", hint: "log rationale", pillar: "office", gate: { room: "office" } },
  { label: "Holdings",                href: "/administrate/holdings",  hint: "group parent", pillar: "office", gate: { room: "studio" } },
  { label: "Reach",                   href: "/grow/reach",             hint: "ads channels", pillar: "office", gate: { room: "studio" } },
  { label: "Reach calendar",          href: "/grow/reach/calendar",    hint: "content calendar", pillar: "office", gate: { room: "studio" } },
  { label: "Commercials",             href: "/grow/commercials",       hint: "deals contracts", pillar: "office", gate: { room: "studio" } },
  { label: "Settings",                href: "/administrate/settings",  hint: "system settings", gate: { room: "office" } },
  { label: "Account",                 href: "/account",                hint: "profile me" },
  { label: "Command center",          href: "/command",                hint: "admin ops", gate: { room: "office" } },

  // Studio (portfolio) — owner only
  { label: "Studio · overview",       href: "/studio",                 hint: "food studios portfolio", gate: { room: "studio" } },
  { label: "Studio · houses",         href: "/studio/houses",          hint: "venues portfolio list", gate: { room: "studio" } },
  { label: "Studio · people",         href: "/studio/people",          hint: "team across houses", gate: { room: "studio" } },
  { label: "Studio · money",          href: "/studio/money",           hint: "portfolio finance", gate: { room: "studio" } },

  // Universal
  { label: "Files",                   href: "/files",                  hint: "docs archive" },
  { label: "Files · inbox",           href: "/files/inbox",            hint: "triage documents" },
  { label: "Home",                    href: "/",                       hint: "root landing" },
];

// Fuzzy scoring — cheap: token overlap + prefix boost. Not perfect but
// enough for a 60-route palette.
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
  { label: "New · booking",       href: "/foh/bookings",                   hint: "reservation", gate: { room: "dining", feature: "bookings" } },
  { label: "New · event",         href: "/administrate/events/new",        hint: "private dining", gate: { room: "office" } },
  { label: "New · commercial",    href: "/grow/commercials/new",           hint: "deal contract", gate: { room: "studio" } },
  { label: "New · relationship",  href: "/grow/relationships/new",         hint: "crm lead", gate: { room: "dining", feature: "foh" } },
  { label: "New · recipe import", href: "/develop/recipes/import",         hint: "paste url", gate: { room: "kitchen" } },
  { label: "New · team invite",   href: "/administrate/team/invite",       hint: "invite whatsapp", gate: { room: "office" } },
  { label: "New · hiring opening", href: "/h/{house}/office/hiring/new",   hint: "open role recruit", gate: { room: "office", feature: "hiring" } },
  { label: "New · order",         href: "/execute/orders",                 hint: "supplier order", gate: { room: "kitchen" } },
  { label: "New · campaign",      href: "/grow/reach/campaigns/new",       hint: "ad reach campaign", gate: { room: "studio" } },
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
