"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ROLES, RoleKey } from "@/lib/roles";
import { EntityKey, ENTITY_ORDER, ENTITY_SHORT, ENTITY_LABEL, ENTITY_H1 } from "@/lib/entities";
import BrandMark from "@/components/BrandMark";

export type EntityStats = {
  label: string;
  reportPeriod: string | null;
  rev: number; cov: number; avg: number;
  revDelta: number | null; avgDelta: number | null;
  inbox: number; events: number; prep: number; cleaningDue: number;
  venues?: { name: string; rev: number; cov: number }[];
};


const eur = (n: number) => "€" + Math.round(n).toLocaleString("en-GB");
const deltaWord = (d: number | null) => d === null ? "" : d >= 0 ? `up ${d}%` : `down ${Math.abs(d)}%`;

function Dashboard({ role, s }: { role: RoleKey; s: EntityStats }) {
  const good = (s.revDelta ?? 0) >= 0 && (s.avgDelta ?? 0) >= 0;
  const verdict = s.revDelta === null ? "" : good ? "you're doing a hell of a job" : "worth a look this week";
  let body;
  if (role === "office") {
    body = (
      <>
        <p className="mt-2 font-serif text-4xl text-ink">{eur(s.rev)}</p>
        <p className="mt-1 font-sans text-[14px] text-ink-soft">{s.cov.toLocaleString("en-GB")} covers{s.revDelta !== null ? " · " + deltaWord(s.revDelta) + " vs prior" : ""}{verdict ? " · " + verdict : ""}</p>
        <p className="mt-3 font-mono text-[12px] text-clay">{s.inbox} in inbox · {s.events} events in pipeline</p>
      </>
    );
  } else if (role === "foh") {
    body = (
      <>
        <p className="mt-2 font-serif text-4xl text-ink">{s.cov.toLocaleString("en-GB")} <span className="font-sans text-base text-ink-soft">covers</span></p>
        <p className="mt-1 font-sans text-[14px] text-ink-soft">{eur(s.avg)} average spend{s.avgDelta !== null ? " · " + deltaWord(s.avgDelta) : ""}{verdict ? " · " + verdict : ""}</p>
        <p className="mt-3 font-mono text-[12px] text-clay">{s.cleaningDue} cleaning due today · {s.events} events on</p>
      </>
    );
  } else {
    body = (
      <>
        <p className="mt-2 font-serif text-4xl text-ink">{eur(s.avg)} <span className="font-sans text-base text-ink-soft">avg spend</span></p>
        <p className="mt-1 font-sans text-[14px] text-ink-soft">{s.avgDelta !== null ? deltaWord(s.avgDelta) + " vs prior period" : "no prior period"}{verdict ? " · " + verdict : ""}</p>
        <p className="mt-3 font-mono text-[12px] text-clay">{s.prep} preps · {s.cleaningDue} cleaning due today</p>
      </>
    );
  }
  return (
    <>
      {body}
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

export default function Home({ statsByEntity }: { statsByEntity: Record<EntityKey, EntityStats> }) {
  const [role, setRole] = useState<RoleKey>("office");
  const [entity, setEntity] = useState<EntityKey>("holdings");
  useEffect(() => {
    const r = localStorage.getItem("fs_role") as RoleKey | null;
    if (r && ROLES[r]) setRole(r);
    const e = localStorage.getItem("fs_entity") as EntityKey | null;
    if (e && statsByEntity[e]) setEntity(e);
  }, [statsByEntity]);
  const chooseRole = (r: RoleKey) => { setRole(r); localStorage.setItem("fs_role", r); };
  const chooseEntity = (e: EntityKey) => { setEntity(e); localStorage.setItem("fs_entity", e); };
  const s = statsByEntity[entity];
  const cfg = ROLES[role];

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <p className="font-sans text-xs font-medium text-ember">Home</p>
      <div className="mt-2"><BrandMark entity={entity} variant="full" tone="light" /></div>
      <p className="mt-1 font-mono text-[11px] uppercase tracking-wide text-clay">{s.reportPeriod ? "last report " + s.reportPeriod : entity === "holdings" ? "latest per venue" : ""}</p>

      <div className="mt-5 flex flex-wrap gap-2">
        {ENTITY_ORDER.map((k) => (
          <button key={k} onClick={() => chooseEntity(k)} className={"rounded-full px-4 py-2 font-sans text-[13px] transition " + (k === entity ? "bg-ink text-paper" : "border border-black/15 text-ink-soft hover:border-ink/40")}>{ENTITY_SHORT[k]}</button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {(Object.keys(ROLES) as RoleKey[]).map((k) => (
          <button key={k} onClick={() => chooseRole(k)} className={"rounded-full px-4 py-2 font-sans text-[13px] transition " + (k === role ? "bg-ember text-[#FCEFE7]" : "border border-black/15 text-ink-soft hover:border-ember/40")}>{ROLES[k].label}</button>
        ))}
      </div>

      <div className="mt-6 rounded-2xl border border-black/10 bg-card p-6">
        <p className="font-sans text-xs font-medium text-ember">Your dashboard · {ENTITY_LABEL[entity]}</p>
        <Dashboard role={role} s={s} />
      </div>

      <div className="mt-6 space-y-3">
        {cfg.points.map((p) => (
          <Link key={p.href} href={p.href} className="block rounded-2xl border border-black/10 bg-card p-5 transition hover:border-ember/40">
            <h2 className="font-serif text-xl text-ink">{p.label}</h2>
            <p className="mt-1 font-sans text-[13px] text-ink-soft">{p.blurb}</p>
          </Link>
        ))}
      </div>

      <div className="mt-8">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">All areas</p>
        <div className="mt-2 flex gap-5 font-sans text-sm text-ember">
          <Link href="/develop">Develop</Link>
          <Link href="/execute">Execute</Link>
          <Link href="/administrate">Administrate</Link>
        </div>
      </div>

      <p className="mt-8 font-mono text-[10px] uppercase tracking-wide text-clay">Entity & role are a preview — sign-in will make this per-person</p>
    </main>
  );
}
