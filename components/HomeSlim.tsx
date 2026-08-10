"use client";

// HomeSlim — the "compression is the brand" home. Ships alongside HomeCompass,
// activated by ?slim=1 or localStorage.fs_chef_slim=1. Same data contract
// (CompassData) — just a slimmer view. Zero risk to daily ops.
//
// Layout (Fable slim spec §7 + Boris's walk feedback):
//   - Top: eyebrow with day/time/service phase (mono, accent).
//   - LEAD (~60% viewport): single serif hero card — the one thing that
//     matters right now. Contents shape-shift by time-of-day:
//       * pre-service (before open):    covers booked + service in Xh + one urgent
//       * during service:               live floor state (covers on now, next drop)
//       * post-service (after close):   yesterday summary + one thing to do
//   - THIN NUMBERS STRIP: 3 hairline tiles, mono kicker + tabular serif number.
//     No graphs. No colors. No icons.
//   - CARDS: Chef-pushed page cards (bounded generativity; ≤20 card types).
//     Come from `alerts` + `highestImpact` merged and typed. Max 4 shown; the
//     rest fold under a "more" link.
//   - Tiny footer: entity switcher + Salas (rooms) drawer link.
//
// Killed vs HomeCompass: duplicate Home logo, pillar row, quick-action chips,
// numbers-tiles-below-fold, new-hires strip, tri-role tabs (rely on TopBar).
//
// DO NOT reintroduce <BrandMark/> here. The authoritative brand anchor is
// TopBar's top-left mark. Grep guard: `git grep -n BrandMark components/HomeSlim.tsx`
// must be empty. Boris walk 2026-08-07 flagged the duplicate as still visible
// (prod stuck at 9d673e3; commit 0154bdd killed it in HomeCompass already).

import Link from "next/link";
import type { CompassData } from "@/components/HomeCompass";
import { EntityKey, ENTITY_ACCENT, ENTITY_LABEL } from "@/lib/entities";
import { useEffect, useState } from "react";
import { onCtx, readEntityCookie } from "@/lib/ctx";

const eur = (n: number) => "€" + Math.round(n).toLocaleString("en-GB");

function greetingFor(mins: number, name?: string): string {
  const t = mins < 12 * 60 ? "Buenos días" : mins < 20 * 60 ? "Buenas tardes" : "Buenas noches";
  return name ? `${t}, ${name.split(" ")[0]}` : t;
}

function servicePhaseLabel(phase: string): string {
  if (phase === "before") return "pre-service";
  if (phase === "during") return "servicio";
  if (phase === "after") return "cierre";
  return "";
}

export default function HomeSlim({ data }: { data: CompassData }) {
  const [entity, setEntity] = useState<EntityKey>("bistro_mondo");
  useEffect(() => {
    setEntity((readEntityCookie() as EntityKey) || "bistro_mondo");
    return onCtx(() => {
      const e = readEntityCookie() as EntityKey | null;
      if (e) setEntity(e);
    });
  }, []);

  const d = data[entity];
  const accent = ENTITY_ACCENT[entity];
  const nowMins = Number(d.now.hhmm.split(":")[0]) * 60 + Number(d.now.hhmm.split(":")[1]);
  const phase = d.header.servicePhase; // 'before' | 'during' | 'after' | 'unknown'

  // Assemble THE lead — one card, time-of-day driven.
  // 2026-08-07 wire fix -- uses real numbers from CompassData.yesterday /
  // weather / upcoming30d / month instead of placeholder prose.
  const yGross = d.yesterday ? eur(d.yesterday.grossEur) : null;
  const yCovers = d.yesterday ? d.yesterday.covers : null;
  const yAvg = d.yesterday && d.yesterday.covers > 0 ? `€${d.yesterday.avgSpendEur.toFixed(2)}` : null;
  const weatherChip = d.weather
    ? [d.weather.label, d.weather.tempMaxC != null ? `${Math.round(d.weather.tempMaxC)}°C` : null, (d.weather.rainMm || 0) > 1 ? "rain" : null].filter(Boolean).join(" · ")
    : null;
  const ylabel = ENTITY_LABEL[entity].split(" ")[0]; // "Bistro" / "Taller" / "Ibiza"
  const monthDelta = d.month && d.month.deltaPct != null
    ? `${d.month.deltaPct > 0 ? "+" : ""}${Math.round(d.month.deltaPct)}% vs last month`
    : null;
  const upcomingNext = d.upcoming30d?.next;
  const upcomingCount = d.upcoming30d?.count || 0;
  const upcomingCopy = upcomingNext
    ? `next: ${upcomingNext.date}${upcomingNext.time ? " " + upcomingNext.time : ""} · ${upcomingNext.party} pax${upcomingNext.name ? " (" + upcomingNext.name + ")" : ""}`
    : null;

  const leadContent = (() => {
    const covers = d.header.coversBooked;
    if (phase === "during") {
      return {
        kicker: `${d.now.dateLabel} · ${d.now.hhmm} · servicio en curso`,
        headline: covers > 0
          ? `${covers} covers on the book tonight.`
          : "Service is open — no bookings on the book.",
        sub: "Chef is listening. Voice-log 86s and covers seated as they happen.",
      };
    }
    if (phase === "after") {
      return {
        kicker: `${d.now.dateLabel} · ${d.now.hhmm} · cierre`,
        headline: yGross && yCovers != null
          ? `Yesterday: ${yGross} · ${yCovers} covers${yAvg ? " · avg " + yAvg : ""}.`
          : "Yesterday closed.",
        sub: [monthDelta, weatherChip].filter(Boolean).join(" · ") || "Review one thing before tomorrow.",
      };
    }
    // pre-service (before) -- the walk case
    const minutesTo = d.header.minutesToService;
    const timeToServiceCopy = minutesTo != null && minutesTo > 0
      ? (minutesTo < 60 ? `service in ${minutesTo} min` : `service in ${Math.round(minutesTo / 60)}h`)
      : "service window ahead";

    // Lead sentence: prefer today's covers; if none, surface upcoming next
    // (Anna 27-Aug / Fincadelica 11-19 Aug shouldn't disappear because
    // today's book is empty). Fall back to yesterday's real number.
    let headline: string;
    if (covers > 0) {
      headline = `${covers} covers on the book. ${timeToServiceCopy}.`;
    } else if (upcomingCopy) {
      headline = `No covers today — ${timeToServiceCopy}. ${upcomingCount} covers on the book in the next 30 days.`;
    } else if (yGross) {
      headline = `Quiet book. ${timeToServiceCopy}.`;
    } else {
      headline = `No covers booked yet. ${timeToServiceCopy}.`;
    }

    // Sub: entity + yesterday's real number + weather.
    // Boris asked for "BM · Yesterday €X gross · Y covers · avg €Z · weather".
    const parts: string[] = [];
    if (yGross && yCovers != null) parts.push(`${ylabel} · yesterday ${yGross} · ${yCovers} covers${yAvg ? " · avg " + yAvg : ""}`);
    else parts.push(greetingFor(nowMins));
    if (weatherChip) parts.push(weatherChip);
    if (monthDelta) parts.push(monthDelta);
    if (upcomingCopy && covers > 0) parts.push(upcomingCopy);

    return {
      kicker: `${d.now.dateLabel} · ${d.now.hhmm} · pre-service`,
      headline,
      sub: parts.join(" · "),
    };
  })();

  // The top ~4 alerts become Chef-pushed page cards (bounded generativity).
  const alerts = d.alerts.slice(0, 4);
  const rest = d.alerts.length - alerts.length;

  return (
    <main className="mx-auto max-w-xl px-6 py-6 pb-24 lg:max-w-5xl lg:px-10 lg:py-10" style={{ ["--accent" as any]: accent }}>
      {/* LEAD — one big serif hero with an accent stripe. Everything else is quieter. */}
      <section
        className="rounded-r-lg border-l-2 bg-paper-deep/40 px-5 py-6"
        style={{ borderLeftColor: "var(--accent)" }}
      >
        <p className="font-mono text-[10px] uppercase tracking-wide" style={{ color: "var(--accent)" }}>{leadContent.kicker}</p>
        <h1 className="mt-3 font-serif text-[30px] leading-[1.1] text-ink lg:text-[44px] lg:leading-[1.05]">
          {leadContent.headline}
        </h1>
        <p className="mt-3 font-serif italic text-[15px] text-ink-soft leading-snug">{leadContent.sub}</p>
      </section>

      {/* THIN NUMBERS STRIP — 3 quiet tiles, hairlines only */}
      <div className="mt-6 grid grid-cols-3 divide-x divide-black/10 border-y border-black/10 lg:mt-8">
        <div className="px-3 py-3">
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">
            {d.yesterday && (d.cashToday === d.yesterday.grossEur) ? "Cash · yesterday" : "Cash · today"}
          </p>
          <p className="mt-1 font-serif text-[22px] text-ink tabular-nums">{d.cashToday != null ? eur(d.cashToday) : "—"}</p>
        </div>
        <div className="px-3 py-3">
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Alerts</p>
          <p className="mt-1 font-serif text-[22px] text-ink tabular-nums">{d.alertsTotal}</p>
        </div>
        <div className="px-3 py-3">
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Top-3 impact</p>
          <p className="mt-1 font-serif text-[22px] text-ink tabular-nums">{d.highestImpact.length}</p>
        </div>
      </div>

      {/* CARDS — Chef-pushed. Alerts land here as bounded-generativity cards. */}
      {alerts.length > 0 ? (
        <section className="mt-6" aria-label="Signals">
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Signals for you</p>
          <ul className="mt-3 flex flex-col gap-3 lg:grid lg:grid-cols-2 lg:gap-4">
            {alerts.map((a) => (
              <li key={a.key}>
                <Link href={a.href} className="block rounded-r-md border-l-2 border-basil/60 bg-paper px-4 py-3 hover:border-basil">
                  <p className="font-mono text-[10px] uppercase tracking-wide text-clay">{a.kicker}</p>
                  <p className="mt-1 font-serif text-[16px] leading-snug text-ink">{a.title}</p>
                </Link>
              </li>
            ))}
          </ul>
          {rest > 0 ? (
            <Link href="/administrate/inbox" className="mt-3 inline-block font-mono text-[10px] uppercase tracking-wide" style={{ color: "var(--accent)" }}>
              +{rest} more →
            </Link>
          ) : null}
        </section>
      ) : null}

      {/* Highest-impact todos as their own quiet block if we have them */}
      {d.highestImpact.length > 0 ? (
        <section className="mt-6" aria-label="On your plate">
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">On your plate</p>
          <ul className="mt-3 flex flex-col gap-2">
            {d.highestImpact.slice(0, 3).map((t) => (
              <li key={t.id}>
                <Link href="/office/master-todo" className="flex items-baseline justify-between gap-3 border-b border-black/5 py-2 hover:border-black/20">
                  <span className="font-serif text-[15px] text-ink truncate">{t.title}</span>
                  <span className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-clay">{Math.round(t.impact_score)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Tiny footer strip — entity label + Salas (rooms) drawer */}
      <div className="mt-10 flex items-baseline justify-between border-t border-black/10 pt-4 font-mono text-[10px] uppercase tracking-wide">
        <span className="text-clay"><span className="text-ink">{ENTITY_LABEL[entity]}</span> · slim mode</span>
        <Link href="/administrate" style={{ color: "var(--accent)" }}>Salas →</Link>
      </div>
    </main>
  );
}
