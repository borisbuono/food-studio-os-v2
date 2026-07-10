"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Row = {
  id: string;
  entity_code: string;
  name: string;
  fiscal_name: string | null;
  status: "prospect" | "onboarding" | "active" | "paused" | "churned";
  tier: "advisory" | "pro" | "enterprise";
  contact_email: string | null;
  contact_phone: string | null;
  venues_count: number;
  accepted_seats: number;
  pending_invites: number;
  mtd_actions: number;
  mtd_cost_eur: number;
  recent_errors: number;
};

const FILTERS: [string, string][] = [
  ["all", "all"],
  ["prospect", "prospects"],
  ["onboarding", "onboarding"],
  ["active", "active"],
  ["paused", "paused"],
];

const statusChip: Record<Row["status"], string> = {
  prospect:   "bg-line-soft text-clay border-line",
  onboarding: "bg-amber/15 text-ochre border-ochre/40",
  active:     "bg-basil/15 text-basil border-basil/30",
  paused:     "bg-line-soft text-ink-soft border-line",
  churned:    "bg-line-soft text-clay border-line",
};

export default function AdvisorConsoleClient({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<string>("all");

  const filtered = useMemo(() => {
    if (filter === "all") return rows;
    return rows.filter((r) => r.status === filter);
  }, [rows, filter]);

  return (
    <section className="mt-10 border-t border-line pt-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          {FILTERS.map(([k, label]) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={
                "font-mono text-[10px] uppercase tracking-wide pb-0.5 " +
                (filter === k
                  ? "text-ink border-b border-ink"
                  : "text-clay border-b border-transparent hover:text-ink")
              }
            >
              {label}
            </button>
          ))}
        </div>
        <Link
          href="/administrate/settings/assistant/onboard?entity=NEW"
          className="font-mono text-[10px] uppercase tracking-wide text-ink border-b border-ink/40 hover:border-ink pb-0.5"
        >
          + add advisory client
        </Link>
      </div>

      {filtered.length === 0 ? (
        <div className="mt-8 border border-dashed border-line px-6 py-10 text-center">
          <p className="font-serif italic text-[15px] text-ink-soft">
            {rows.length === 0
              ? "No advisory clients yet. Open the wizard to bring the first one on — Michael's group, Cala Boix, or a Serena referral."
              : "No clients match this filter."}
          </p>
          {rows.length === 0 ? (
            <Link
              href="/administrate/settings/assistant/onboard?entity=NEW"
              className="mt-4 inline-block font-mono text-[10px] uppercase tracking-wide"
              style={{ color: "var(--accent)" }}
            >
              open the wizard →
            </Link>
          ) : null}
        </div>
      ) : (
        <table className="mt-6 w-full border-collapse">
          <thead>
            <tr className="border-b border-black/20 font-mono text-[10px] uppercase tracking-wide text-clay">
              <th className="py-2 text-left font-normal">Client</th>
              <th className="py-2 text-left font-normal">Status</th>
              <th className="py-2 text-right font-normal">Venues</th>
              <th className="py-2 text-right font-normal">Seats</th>
              <th className="py-2 text-right font-normal">Cost MTD</th>
              <th className="py-2 text-left font-normal">Flags</th>
            </tr>
          </thead>
          <tbody className="font-sans text-[13px] text-ink">
            {filtered.map((r) => {
              const flags: string[] = [];
              if (r.pending_invites > 0) flags.push(r.pending_invites + " invite" + (r.pending_invites === 1 ? "" : "s") + " pending");
              if (r.recent_errors > 0)   flags.push(r.recent_errors + " recent error" + (r.recent_errors === 1 ? "" : "s"));
              return (
                <tr
                  key={r.id}
                  className="border-b border-black/5 cursor-pointer hover:bg-line-soft/40"
                  onClick={() => router.push("/administrate/advisor/" + r.id)}
                >
                  <td className="py-3">
                    <p className="font-serif text-[15px] text-ink">{r.name}</p>
                    <p className="font-mono text-[10px] uppercase tracking-wide text-clay">
                      {r.entity_code}
                      {r.fiscal_name ? " · " + r.fiscal_name : ""}
                    </p>
                  </td>
                  <td className="py-3">
                    <span className={"inline-block border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide " + statusChip[r.status]}>
                      {r.status}
                    </span>
                    <span className="ml-2 font-mono text-[10px] text-clay capitalize">{r.tier}</span>
                  </td>
                  <td className="py-3 text-right font-mono text-[12px] text-ink-soft">
                    {r.venues_count || "—"}
                  </td>
                  <td className="py-3 text-right font-mono text-[12px] text-ink-soft">
                    {r.accepted_seats || "—"}
                  </td>
                  <td className="py-3 text-right font-mono text-[12px] text-ink-soft">
                    {r.mtd_cost_eur > 0 ? "€" + r.mtd_cost_eur.toFixed(2) : "—"}
                  </td>
                  <td className="py-3 font-mono text-[10px] text-ink-soft">
                    {flags.length ? flags.join(" · ") : <span className="text-clay">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
