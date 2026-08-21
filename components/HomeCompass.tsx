"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AssistantBriefPanel from "@/components/AssistantBriefPanel";
import NewHiresStrip from "@/components/NewHiresStrip";
import { ROLES, RoleKey } from "@/lib/roles";
import { EntityKey, ENTITY_ORDER, ENTITY_LABEL, ENTITY_ACCENT } from "@/lib/entities";
import { getMyProfile, MyProfile } from "@/lib/profile";
import { onCtx, readEntityCookie, writeCookie } from "@/lib/ctx";
import { pillarForRole, PILLAR_LANDING } from "@/lib/routing/pillar-map";

// Architecture v2 — the Home compass.
// This replaces the modular tile grid with a daily-loop timeline + alerts strip.
// The OS holds the shape of the day; the operator does the work.
//
// DO NOT reintroduce <BrandMark/> or a "/" Link with a logo in this file.
// The authoritative Home button + brand anchor is the top-left mark in
// components/TopBar.tsx. Task #128 (commit 0154bdd) killed the duplicate;
// Boris walk 2026-08-07 re-flagged it (prod stuck at 9d673e3, deploy needed).
// A grep guard: `git grep -n BrandMark components/HomeCompass.tsx` must be empty.

export type LoopStep = {
  key: "morning" | "deliveries" | "prep" | "service" | "eod";
  label: string;
  detail: string;
  status: "done" | "in_progress" | "upcoming";
  timeLabel?: string;
  href: string;
};

export type CompassAlert = {
  key: string;
  kicker: string;   // small mono line (e.g. "Invoice · Vergara")
  title: string;    // the sentence
  href: string;
};

export type MasterTodoLite = {
  id: string;
  title: string;
  impact_score: number;
  due_at: string | null;
};

export type CompassData = Record<EntityKey, {
  label: string;
  now: { hhmm: string; dateLabel: string };
  header: {
    coversBooked: number;
    minutesToService: number | null; // null when service is currently open or closed for the day
    servicePhase: "before" | "during" | "after" | "unknown";
  };
  loop: LoopStep[];
  alerts: CompassAlert[];
  alertsTotal: number;
  // owner-only tile
  cashToday: number | null;
  // PA integration Sprint 1 — top 3 highest-impact open Master_ToDo rows.
  highestImpact: MasterTodoLite[];
  // -- v2 wire additions (2026-08-07) -- real data pulled by app/page.tsx
  yesterday: { date: string; grossEur: number; covers: number; avgSpendEur: number } | null;
  weather: { date: string; tempMaxC: number | null; label: string | null; rainMm: number | null } | null;
  month: { thisGrossEur: number; priorGrossEur: number | null; deltaPct: number | null } | null;
  upcoming30d: { count: number; next: { date: string; time: string | null; party: number; name: string | null } | null };
  cashPosition: { latestEur: number | null; weekEnding: string | null; apPendienteEur: number | null } | null;
}>;

const ENTITY_CODE: Record<EntityKey, string> = { holdings: "BBH", bistro_mondo: "BM", taller: "IFL" };

const PILLARS: { href: string; label: string; blurb: string }[] = [
  { href: "/develop/menu-engineering", label: "Develop", blurb: "Menu, recipes, wine, lexicon" },
  { href: "/execute/pass", label: "Execute", blurb: "Pass, prep, deliveries, service" },
  { href: "/administrate/finance", label: "Administrate", blurb: "Numbers, invoices, team" },
  { href: "/grow", label: "Grow", blurb: "Guests, offers, reach, reviews" },
];

const eur = (n: number) => "€" + Math.round(n).toLocaleString("en-GB");

function StatusGlyph({ status }: { status: LoopStep["status"] }) {
  if (status === "done") return <span className="font-mono text-[13px] text-basil">✓</span>;
  if (status === "in_progress") return <span className="font-mono text-[13px]" style={{ color: "var(--accent)" }}>→</span>;
  return <span className="font-mono text-[13px] text-clay">○</span>;
}

// The role decides which loop steps we lead with visually.
// Owner sees the full loop + flags + cash.
// Chef sees deliveries + prep + service as focus.
// FOH sees service + bookings.
function stepsForRole(loop: LoopStep[], role: RoleKey): LoopStep[] {
  if (role === "office") return loop;
  if (role === "boh") {
    // Chef doesn't care about morning brief/EOD as the primary focus, but keeps them visible
    return loop;
  }
  // FOH sees the same loop — service is what matters
  return loop;
}

function Timeline({ loop, role }: { loop: LoopStep[]; role: RoleKey }) {
  const steps = stepsForRole(loop, role);
  const active = steps.find((s) => s.status === "in_progress") || steps.find((s) => s.status === "upcoming") || steps[steps.length - 1];
  return (
    <ul className="mt-4 divide-y divide-black/5 border-t border-b border-black/10">
      {steps.map((s) => {
        const isActive = s.key === active?.key && s.status !== "done";
        const time = s.timeLabel ? <span className="font-mono text-[11px] text-clay">{s.timeLabel}</span> : null;
        const row = (
          <div className={"flex items-baseline justify-between gap-4 py-3 " + (isActive ? "" : "")}>
            <div className="flex items-baseline gap-3">
              <StatusGlyph status={s.status} />
              <div>
                <p className={"font-sans text-[15px] " + (isActive ? "text-ink font-semibold" : s.status === "done" ? "text-ink-soft" : "text-ink")}>
                  {s.label}
                </p>
                <p className="mt-0.5 font-sans text-[12px] text-ink-soft">{s.detail}</p>
              </div>
            </div>
            <div className="text-right">
              {time}
              {isActive ? <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wide" style={{ color: "var(--accent)" }}>continue ›</p> : null}
            </div>
          </div>
        );
        return (
          <li key={s.key}>
            {isActive || s.status === "in_progress" ? (
              <Link href={s.href} className="block transition hover:opacity-80">{row}</Link>
            ) : row}
          </li>
        );
      })}
    </ul>
  );
}

function AlertsStrip({ alerts, total }: { alerts: CompassAlert[]; total: number }) {
  if (total === 0) {
    return (
      <div className="mt-6 border-t border-black/10 pt-4">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Alerts requiring you</p>
        <p className="mt-2 font-serif italic text-[14px] text-ink-soft">Nothing waiting. Your day is clear.</p>
      </div>
    );
  }
  return (
    <div className="mt-6 border-t border-black/10 pt-4">
      <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Alerts requiring you · {total}</p>
      <ul className="mt-2 divide-y divide-black/5">
        {alerts.slice(0, 3).map((a) => (
          <li key={a.key}>
            <Link href={a.href} className="block py-2.5 transition hover:opacity-80">
              <p className="font-mono text-[10px] uppercase tracking-wide text-clay">{a.kicker}</p>
              <p className="mt-0.5 font-sans text-[14px] text-ink">{a.title}</p>
            </Link>
          </li>
        ))}
        {total > 3 ? (
          <li className="py-2 font-mono text-[11px] text-clay">+ {total - 3} more waiting</li>
        ) : null}
      </ul>
    </div>
  );
}

function HighestImpactStrip({ todos }: { todos: MasterTodoLite[] }) {
  if (!todos || todos.length === 0) {
    return (
      <div className="mt-6 border-t border-black/10 pt-4">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Highest impact</p>
        <p className="mt-2 font-serif italic text-[14px] text-ink-soft">Nothing on the plate — the PA is quiet.</p>
        <Link href="/administrate/master-todo" className="mt-2 inline-block font-mono text-[10px] uppercase tracking-wide" style={{ color: "var(--accent)" }}>
          Open Master ToDo ›
        </Link>
      </div>
    );
  }
  return (
    <div className="mt-6 border-t border-black/10 pt-4">
      <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Highest impact · {todos.length}</p>
      <ul className="mt-2 divide-y divide-black/5">
        {todos.map((t) => (
          <li key={t.id}>
            <Link href="/administrate/master-todo" className="block py-2.5 transition hover:opacity-80">
              <p className="font-mono text-[10px] uppercase tracking-wide text-clay">impact {"·".repeat(t.impact_score)}</p>
              <p className="mt-0.5 font-sans text-[14px] text-ink">{t.title}</p>
            </Link>
          </li>
        ))}
      </ul>
      <Link href="/administrate/master-todo" className="mt-2 inline-block font-mono text-[10px] uppercase tracking-wide" style={{ color: "var(--accent)" }}>
        Open Master ToDo ›
      </Link>
    </div>
  );
}

function Header({ label, data }: { label: string; data: CompassData[EntityKey] }) {
  const bookedText = data.header.coversBooked > 0
    ? `${data.header.coversBooked} covers booked`
    : "no bookings yet";
  const phaseText = (() => {
    if (data.header.servicePhase === "during") return "· service in progress";
    if (data.header.servicePhase === "after") return "· service closed";
    if (data.header.minutesToService !== null && data.header.minutesToService > 0) {
      const h = Math.floor(data.header.minutesToService / 60);
      const m = data.header.minutesToService % 60;
      return `· service in ${h > 0 ? h + "h" : ""}${m > 0 ? m + "m" : h === 0 ? "0m" : ""}`;
    }
    return "";
  })();
  return (
    <div>
      <p className="font-mono text-[11px] uppercase tracking-wide text-clay">
        {data.now.dateLabel} · {data.now.hhmm} · {label}
      </p>
      <p className="mt-1 font-serif text-[15px] text-ink-soft">
        <span className="font-serif italic">{bookedText}</span> <span className="text-clay">{phaseText}</span>
      </p>
    </div>
  );
}

export default function HomeCompass({ data }: { data: CompassData }) {
  const router = useRouter();
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [loaded, setLoaded] = useState(false);
  // Auto-landing gate: once a signed-in profile is loaded we redirect to the
  // matching pillar. `redirected` prevents the compass from flashing before the
  // route change lands. Signed-out preview keeps the compass visible.
  const [redirected, setRedirected] = useState(false);
  const [role, setRole] = useState<RoleKey>("office");
  const [entity, setEntity] = useState<EntityKey>(() => {
    const c = readEntityCookie() as EntityKey | null;
    return c && (ENTITY_ORDER as string[]).includes(c) ? c : "bistro_mondo";
  });
  const [userAccent, setUserAccent] = useState<string | null>(null);

  useEffect(() => {
    getMyProfile().then((p) => {
      setProfile(p); setLoaded(true);
      if (p && !p.isAdmin) {
        if (p.entity && data[p.entity]) { setEntity(p.entity); localStorage.setItem("fs_entity", p.entity); writeCookie(p.entity); }
        setRole(p.world); localStorage.setItem("fs_role", p.world);
        if (p.color) { setUserAccent(p.color); localStorage.setItem("fs_user_accent", p.color); }
      } else {
        const r = localStorage.getItem("fs_role") as RoleKey | null; if (r && ROLES[r]) setRole(r);
        const e = localStorage.getItem("fs_entity") as EntityKey | null; if (e && data[e]) setEntity(e);
        const ua = localStorage.getItem("fs_user_accent"); setUserAccent(ua);
        if (p && p.color && !ua) setUserAccent(p.color);
      }
      // Role-based auto-landing (Pillars #1). A signed-in profile with a
      // known role goes straight to its pillar landing. Opt-out via the
      // `?compass=1` query param so admins can still see the daily compass
      // from the home button. Signed-out preview keeps the compass.
      if (p) {
        try {
          const sp = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
          if (sp.get("compass") === "1") return;
          const pillar = pillarForRole(p.dbRole, p.world);
          const target = PILLAR_LANDING[pillar];
          // Only redirect if we're actually on / (defensive — HomeCompass
          // is only mounted at /, but future embedding shouldn't nuke the page).
          if (typeof window !== "undefined" && window.location.pathname === "/") {
            setRedirected(true);
            router.replace(target);
          }
        } catch {}
      }
    });
  }, [data, router]);

  // Sync with TopBar entity/role changes
  useEffect(() => onCtx(() => {
    const e = localStorage.getItem("fs_entity") as EntityKey | null; if (e && data[e]) setEntity(e);
    const r = localStorage.getItem("fs_role") as RoleKey | null; if (r && ROLES[r]) setRole(r);
    setUserAccent(localStorage.getItem("fs_user_accent"));
  }), [data]);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.style.setProperty("--accent", userAccent || ENTITY_ACCENT[entity]);
    }
  }, [entity, userAccent]);

  const scopedNoVenue = loaded && profile && !profile.isAdmin && !profile.entity;
  const d = data[entity];
  const greeting = profile?.name ? profile.name.split(" ")[0] : null;
  const isOffice = role === "office";

  // While we're bouncing to the role-matched pillar, render a quiet holding
  // frame instead of the full compass to avoid a flash of the wrong home.
  if (redirected) {
    return (
      <main className="mx-auto max-w-xl px-6 py-12">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Loading your world…</p>
      </main>
    );
  }

  if (scopedNoVenue) {
    return (
      <main className="mx-auto max-w-xl px-6 py-12">
        <p className="font-sans text-xs font-medium" style={{ color: "var(--accent)" }}>Welcome{greeting ? `, ${greeting}` : ""}</p>
        <h1 className="mt-2 font-serif text-3xl text-ink">You&apos;re signed in</h1>
        <p className="mt-3 font-serif text-[17px] leading-relaxed text-ink-soft">
          No venue is assigned to you yet. Ask your manager to add you to a venue, then reload — your home will fill with today&apos;s loop.
        </p>
        <Link href="/account" className="mt-6 inline-block font-sans text-sm text-ink-soft">Your profile →</Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-10" style={{ ["--accent" as any]: userAccent || ENTITY_ACCENT[entity] }}>
      <p className="font-sans text-xs font-medium" style={{ color: "var(--accent)" }}>
        {greeting ? `Hello, ${greeting}` : "Home"}
      </p>
      <div className="mt-6 border-t border-b border-black/10 py-5">
        <Header label={ENTITY_LABEL[entity]} data={d} />
      </div>

      {/* Today's Brief — Assistant Layer Sprint 2 */}
      <AssistantBriefPanel entity={ENTITY_CODE[entity]} />

      {/* THE COMPASS — where in today's loop we are */}
      <section className="mt-2">
        <p className="mt-6 font-mono text-[10px] uppercase tracking-wide text-clay">Today&apos;s loop</p>
        <Timeline loop={d.loop} role={role} />
      </section>

      {/* Owner-only: cash today headline */}
      {isOffice && d.cashToday !== null ? (
        <div className="mt-6 border-b border-black/10 pb-4">
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Cash today</p>
          <p className="mt-1 font-serif text-4xl text-ink leading-none">{eur(d.cashToday)}</p>
          <Link href="/administrate/finance/dashboard" className="mt-2 inline-block font-mono text-[10px] uppercase tracking-wide" style={{ color: "var(--accent)" }}>
            The numbers ›
          </Link>
        </div>
      ) : null}

      {/* Highest-impact strip — Master_ToDo top 3 */}
      <HighestImpactStrip todos={d.highestImpact} />

      {/* Alerts strip */}
      <AlertsStrip alerts={d.alerts} total={d.alertsTotal} />

      {/* New hires this week — Office-only, zero-state hidden */}
      <NewHiresStrip />

      {/* 4-pillar quick jump — for when you know what you want */}
      <div className="mt-8 border-t border-black/10 pt-4">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Jump to</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {PILLARS.filter((p) => {
            // FOH and BOH don't get Administrate quick-jump
            if (!isOffice && p.href.startsWith("/administrate")) return false;
            return true;
          }).map((p) => (
            <Link key={p.href} href={p.href}
              className="rounded-full border border-black/15 px-3 py-1.5 font-sans text-[12px] text-ink-soft transition hover:border-ink/40 hover:text-ink"
              title={p.blurb}>
              {p.label}
            </Link>
          ))}
        </div>
      </div>

      {!profile ? (
        <p className="mt-8 font-mono text-[10px] uppercase tracking-wide text-clay">Previewing — sign in to bind this to you</p>
      ) : null}
    </main>
  );
}
