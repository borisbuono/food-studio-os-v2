"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ROLES, RoleKey } from "@/lib/roles";
import { EntityKey, ENTITY_LABEL, ENTITY_ACCENT } from "@/lib/entities";
import BrandMark from "@/components/BrandMark";
import { getMyProfile, MyProfile } from "@/lib/profile";
import { onCtx, writeCookie } from "@/lib/ctx";

export type PeriodAgg = { rev: number; cov: number; avg: number; n: number };
export type PeriodKey = "week" | "lastWeek" | "month" | "ytd";

export type EntityStats = {
  label: string;
  reportPeriod: string | null;
  rev: number; cov: number; avg: number;
  revDelta: number | null; avgDelta: number | null;
  inbox: number; events: number; prep: number; cleaningDue: number;
  venues?: { name: string; rev: number; cov: number }[];
  trial?: boolean; dishCount?: number; contribution?: number; varianceLoss?: number;
  periods?: { week: PeriodAgg; lastWeek: PeriodAgg; month: PeriodAgg; ytd: PeriodAgg };
  // brief signals
  specials?: string[]; eightySix?: string[];
  deliveriesDue?: number; deliveriesNext?: string | null;
  eventsToday?: { title: string; guests: number }[];
  messages?: number;
};

const eur = (n: number) => "€" + Math.round(n).toLocaleString("en-GB");
const deltaWord = (d: number | null) => d === null ? "" : d >= 0 ? `up ${d}%` : `down ${Math.abs(d)}%`;

// The Office (admin) numbers view — period shuffler (week / last week / month / YTD) over EOD reports.
const PERIOD_TABS: { key: PeriodKey; label: string }[] = [
  { key: "week", label: "This week" },
  { key: "lastWeek", label: "Last week" },
  { key: "month", label: "Month" },
  { key: "ytd", label: "YTD" },
];

function OfficeDashboard({ s }: { s: EntityStats }) {
  const [pk, setPk] = useState<PeriodKey>("week");
  if (s.trial) {
    return (
      <>
        <p className="mt-2 font-serif text-4xl text-ink">{s.dishCount} <span className="font-sans text-base text-ink-soft">dishes costed</span></p>
        <p className="mt-1 font-sans text-[14px] text-ink-soft">€{(s.contribution || 0).toLocaleString("en-GB")} contribution · €{(s.varianceLoss || 0).toFixed(2)} variance to chase</p>
        <p className="mt-3 font-mono text-[12px] text-clay">Sandbox venue · the engine runs end to end here</p>
      </>
    );
  }
  const P = s.periods;
  if (!P) {
    // fallback to the legacy single-report headline if periods weren't computed
    const good = (s.revDelta ?? 0) >= 0 && (s.avgDelta ?? 0) >= 0;
    const verdict = s.revDelta === null ? "" : good ? "you're doing a hell of a job" : "worth a look this week";
    return (
      <>
        <p className="mt-2 font-serif text-4xl text-ink">{eur(s.rev)}</p>
        <p className="mt-1 font-sans text-[14px] text-ink-soft">{s.cov.toLocaleString("en-GB")} covers{s.revDelta !== null ? " · " + deltaWord(s.revDelta) + " vs prior" : ""}{verdict ? " · " + verdict : ""}</p>
        <p className="mt-3 font-mono text-[12px] text-clay">{s.inbox} in inbox · {s.events} events in pipeline</p>
      </>
    );
  }
  const cur = P[pk];
  const wow = pk === "week" && P.lastWeek.rev ? Math.round((P.week.rev / P.lastWeek.rev - 1) * 100) : null;
  return (
    <>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {PERIOD_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setPk(t.key)}
            className={"rounded-full px-3 py-1 font-sans text-[12px] transition " + (pk === t.key ? "text-white" : "border border-black/10 text-ink-soft hover:border-ember/40")}
            style={pk === t.key ? { backgroundColor: "var(--accent)" } : undefined}
          >
            {t.label}
          </button>
        ))}
      </div>
      <p className="mt-3 font-serif text-4xl text-ink">{eur(cur.rev)}</p>
      <p className="mt-1 font-sans text-[14px] text-ink-soft">
        {cur.cov.toLocaleString("en-GB")} covers · avg {eur(cur.avg)}
        {wow !== null ? " · " + deltaWord(wow) + " vs last week" : ""}
      </p>
      <p className="mt-3 font-mono text-[12px] text-clay">
        {cur.n} service{cur.n === 1 ? "" : "s"} · {s.inbox} in inbox · {s.events} events in pipeline
      </p>
      {s.venues ? (
        <ul className="mt-4 divide-y divide-black/10 border-t border-black/10">
          {s.venues.map((v, i) => (
            <li key={i} className="flex items-baseline justify-between py-2">
              <span className="font-sans text-[14px] text-ink">{v.name}</span>
              <span className="font-mono text-[12px] text-ink-soft">{eur(v.rev)} · {v.cov.toLocaleString("en-GB")} cov</span>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

// The real brief — what a FOH/BOH person needs the moment they open the app.
function Brief({ role, s }: { role: RoleKey; s: EntityStats }) {
  const Row = ({ label, value, why, soft }: { label: string; value: string; why?: string; soft?: boolean }) => (
    <div className="flex flex-col gap-0.5 py-2.5">
      <div className="flex items-baseline justify-between gap-4">
        <span className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-clay">{label}</span>
        <span className={"text-right font-sans text-[14px] " + (soft ? "text-clay" : "text-ink")}>{value}</span>
      </div>
      {why && !soft ? <p className="text-right font-sans text-[11px] leading-snug text-ink-soft">{why}</p> : null}
    </div>
  );
  const tonight = s.eventsToday && s.eventsToday.length
    ? s.eventsToday.map((e) => `${e.title}${e.guests ? ` · ${e.guests} guests` : ""}`).join("  ·  ")
    : null;
  const specials = s.specials && s.specials.length ? s.specials.join(", ") : null;
  const sixed = s.eightySix && s.eightySix.length ? s.eightySix.join(", ") : null;
  const deliveries = s.deliveriesDue
    ? `${s.deliveriesDue} due${s.deliveriesNext ? ` · next ${s.deliveriesNext}` : ""}`
    : null;
  const msgs = s.messages ? `${s.messages} need a look` : null;

  return (
    <div className="divide-y divide-black/10">
      <Row label="Tonight" value={tonight || "Nothing booked yet — covers connect when a booking system is linked"} why="Who's coming. Sets the pace for the night." soft={!tonight} />
      {role === "boh" ? <Row label="Prep" value={s.prep ? `${s.prep} on your station list` : "Nothing queued"} why="Scaled to tomorrow's covers — opens the recipe + SOP." soft={!s.prep} /> : null}
      <Row label="Specials" value={specials || "None flagged today"} why="What the floor pushes tonight. Tap to read the pitch." soft={!specials} />
      <Row label="86 tonight" value={sixed || "Nothing 86’d"} why="Tell the floor before they tell a guest." soft={!sixed} />
      <Row label="Deliveries" value={deliveries || "None due"} why="Photograph the note on arrival — costs update everywhere." soft={!deliveries} />
      <Row label="Cleaning" value={s.cleaningDue ? `${s.cleaningDue} due today` : "All clear"} why="HACCP sign-off — auditable, station-by-station." soft={!s.cleaningDue} />
      <Row label="Messages" value={msgs || "Inbox clear"} why="The team, in the OS. Not WhatsApp." soft={!msgs} />
    </div>
  );
}


export default function Home({ statsByEntity }: { statsByEntity: Record<EntityKey, EntityStats> }) {
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [role, setRole] = useState<RoleKey>("office");
  const [entity, setEntity] = useState<EntityKey>("holdings");
  const [userAccent, setUserAccent] = useState<string | null>(null);

  useEffect(() => {
    getMyProfile().then((p) => {
      setProfile(p); setLoaded(true);
      if (p && !p.isAdmin) {
        if (p.entity && statsByEntity[p.entity]) { setEntity(p.entity); localStorage.setItem("fs_entity", p.entity); writeCookie(p.entity); }
        setRole(p.world); localStorage.setItem("fs_role", p.world);
        if (p.color) { setUserAccent(p.color); localStorage.setItem("fs_user_accent", p.color); }
      } else {
        const r = localStorage.getItem("fs_role") as RoleKey | null; if (r && ROLES[r]) setRole(r);
        const e = localStorage.getItem("fs_entity") as EntityKey | null; if (e && statsByEntity[e]) setEntity(e);
        const ua = localStorage.getItem("fs_user_accent"); setUserAccent(ua);
        if (p && p.color && !ua) setUserAccent(p.color);
      }
    });
  }, [statsByEntity]);

  // follow context changes coming from the TopBar switcher (admins / preview)
  useEffect(() => onCtx(() => {
    const e = localStorage.getItem("fs_entity") as EntityKey | null; if (e && statsByEntity[e]) setEntity(e);
    const r = localStorage.getItem("fs_role") as RoleKey | null; if (r && ROLES[r]) setRole(r);
    setUserAccent(localStorage.getItem("fs_user_accent"));
  }), [statsByEntity]);

  useEffect(() => { if (typeof document !== "undefined") document.documentElement.style.setProperty("--accent", userAccent || ENTITY_ACCENT[entity]); }, [entity, userAccent]);

  const scopedNoVenue = loaded && profile && !profile.isAdmin && !profile.entity;
  const s = statsByEntity[entity];
  const isOffice = role === "office";
  const isAdmin = !!profile?.isAdmin;
  const greeting = profile?.name ? profile.name.split(" ")[0] : null;

  if (scopedNoVenue) {
    return (
      <main className="mx-auto max-w-xl px-6 py-12">
        <p className="font-sans text-xs font-medium" style={{ color: "var(--accent)" }}>Welcome{greeting ? `, ${greeting}` : ""}</p>
        <h1 className="mt-2 font-serif text-3xl text-ink">You’re signed in</h1>
        <p className="mt-3 font-serif text-[17px] leading-relaxed text-ink-soft">No venue is assigned to you yet. Ask your manager to add you to a venue, then reload — your home will fill with tonight’s brief.</p>
        <Link href="/account" className="mt-6 inline-block font-sans text-sm text-ember">Your profile →</Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-10" style={{ ["--accent" as any]: userAccent || ENTITY_ACCENT[entity] }}>
      <p className="font-sans text-xs font-medium" style={{ color: "var(--accent)" }}>{greeting ? `Hello, ${greeting}` : "Home"}</p>
      <div className="mt-2"><BrandMark entity={entity} variant="full" tone="light" /></div>
      <p className="mt-1 font-mono text-[11px] uppercase tracking-wide text-clay">
        {ROLES[role].label}{s.reportPeriod && isOffice ? " · last report " + s.reportPeriod : ""}
      </p>

      {/* PRIME REAL ESTATE — the brief (FOH/BOH) or the numbers (Office) */}
      <div className="mt-6 rounded-2xl border border-black/10 bg-card p-6">
        <p className="font-sans text-xs font-medium" style={{ color: "var(--accent)" }}>
          {isOffice ? `Your dashboard · ${ENTITY_LABEL[entity]}` : `Your brief · ${ENTITY_LABEL[entity]}`}
        </p>
        {isOffice ? <OfficeDashboard s={s} /> : <Brief role={role} s={s} />}
      </div>

      {/* Role actions — the few things this person reaches for */}
      <div className="mt-6 space-y-3">
        {ROLES[role].points.filter((p) => p.href !== "/administrate/holdings" || entity === "holdings").map((p) => (
          <Link key={p.href} href={p.href} className="block rounded-2xl border border-black/10 bg-card p-5 transition hover:border-ember/40">
            <h2 className="font-serif text-xl text-ink">{p.label}</h2>
            <p className="mt-1 font-sans text-[13px] text-ink-soft">{p.blurb}</p>
          </Link>
        ))}
      </div>

      {/* Academy — your skill ladder, for any signed-in person */}
      {profile ? (
        <div className="mt-6">
          <Link href="/academy" className="block rounded-2xl border border-black/10 bg-card p-5 transition hover:border-ember/40">
            <h2 className="font-serif text-xl text-ink">Your academy</h2>
            <p className="mt-1 font-sans text-[13px] text-ink-soft">What you’ve learned, what you can do, what you can manage.</p>
          </Link>
          <Link href="/messages" className="mt-3 block rounded-2xl border border-black/10 bg-card p-5 transition hover:border-ember/40">
            <h2 className="font-serif text-xl text-ink">Messages</h2>
            <p className="mt-1 font-sans text-[13px] text-ink-soft">The team — channels and direct messages, in the OS.</p>
          </Link>
        </div>
      ) : null}

      {!profile ? (
        <p className="mt-8 font-mono text-[10px] uppercase tracking-wide text-clay">Previewing — sign in to bind this to you</p>
      ) : null}
    </main>
  );
}
