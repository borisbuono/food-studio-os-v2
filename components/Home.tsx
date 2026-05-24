"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ROLES, RoleKey } from "@/lib/roles";

export type HomeStats = {
  reportPeriod: string | null;
  rev: number; cov: number; avg: number;
  revDelta: number | null; avgDelta: number | null;
  inbox: number; events: number; prep: number; cleaningDue: number;
};

const eur = (n: number) => "€" + Math.round(n).toLocaleString("en-GB");
const deltaWord = (d: number | null) => d === null ? "" : d >= 0 ? `up ${d}%` : `down ${Math.abs(d)}%`;

function Dashboard({ role, s }: { role: RoleKey; s: HomeStats }) {
  const good = (s.revDelta ?? 0) >= 0 && (s.avgDelta ?? 0) >= 0;
  const verdict = s.revDelta === null ? "" : good ? "you're doing a hell of a job" : "worth a look this week";
  if (role === "office") {
    return (
      <>
        <p className="mt-2 font-serif text-4xl text-ink">{eur(s.rev)}</p>
        <p className="mt-1 font-sans text-[14px] text-ink-soft">{s.cov.toLocaleString("en-GB")} covers · {deltaWord(s.revDelta)} vs prior{verdict ? " · " + verdict : ""}</p>
        <p className="mt-3 font-mono text-[12px] text-clay">{s.inbox} in inbox · {s.events} events in pipeline</p>
      </>
    );
  }
  if (role === "foh") {
    return (
      <>
        <p className="mt-2 font-serif text-4xl text-ink">{s.cov.toLocaleString("en-GB")} <span className="font-sans text-base text-ink-soft">covers</span></p>
        <p className="mt-1 font-sans text-[14px] text-ink-soft">{eur(s.avg)} average spend · {deltaWord(s.avgDelta)}{verdict ? " · " + verdict : ""}</p>
        <p className="mt-3 font-mono text-[12px] text-clay">{s.cleaningDue} cleaning due today · {s.events} events on</p>
      </>
    );
  }
  return (
    <>
      <p className="mt-2 font-serif text-4xl text-ink">{eur(s.avg)} <span className="font-sans text-base text-ink-soft">avg spend</span></p>
      <p className="mt-1 font-sans text-[14px] text-ink-soft">{deltaWord(s.avgDelta)} vs prior period{verdict ? " · " + verdict : ""}</p>
      <p className="mt-3 font-mono text-[12px] text-clay">{s.prep} preps · {s.cleaningDue} cleaning due today</p>
    </>
  );
}

export default function Home({ stats }: { stats: HomeStats }) {
  const [role, setRole] = useState<RoleKey>("office");
  useEffect(() => { const r = localStorage.getItem("fs_role") as RoleKey | null; if (r && ROLES[r]) setRole(r); }, []);
  const choose = (r: RoleKey) => { setRole(r); localStorage.setItem("fs_role", r); };
  const cfg = ROLES[role];

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <p className="font-serif text-3xl text-ink">Food Studios</p>
      <p className="mt-1 font-mono text-[11px] uppercase tracking-wide text-clay">{stats.reportPeriod ? "Bistro Mondo · last report " + stats.reportPeriod : "Bistro Mondo"}</p>

      <div className="mt-6 flex flex-wrap gap-2">
        {(Object.keys(ROLES) as RoleKey[]).map((k) => (
          <button key={k} onClick={() => choose(k)} className={"rounded-full px-4 py-2 font-sans text-[13px] transition " + (k === role ? "bg-ember text-[#FCEFE7]" : "border border-black/15 text-ink-soft hover:border-ember/40")}>{ROLES[k].label}</button>
        ))}
      </div>

      <div className="mt-6 rounded-2xl border border-black/10 bg-card p-6">
        <p className="font-sans text-xs font-medium text-ember">Your dashboard</p>
        <Dashboard role={role} s={stats} />
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

      <p className="mt-8 font-mono text-[10px] uppercase tracking-wide text-clay">Roles are a preview — sign-in will make this per-person</p>
    </main>
  );
}
