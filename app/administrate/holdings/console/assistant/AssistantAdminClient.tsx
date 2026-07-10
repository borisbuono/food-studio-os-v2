"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

// Filter chips + row table. Impersonate switches the entity cookie and
// pushes the user into the venue-scoped assistant surface.

type Row = {
  entity_code: string;
  label: string;
  is_advisory: boolean;
  tier: string;
  actions: number;
  cost_eur: number;
  actions_cap: number;
  cost_cap_eur: number;
  channels: number;
  playbooks: number;
  brief_today: boolean;
  last_error: string | null;
};

// entity_code → fs_entity cookie value (top switcher uses these keys).
const ENTITY_TO_KEY: Record<string, string> = {
  IFL: "taller",
  BM:  "bistro_mondo",
  BBH: "holdings",
};

const FILTERS: [string, string][] = [
  ["all", "all"], ["IFL", "IFL"], ["BM", "BM"], ["BBH", "BBH"], ["ADV", "advisory clients"],
];

export default function AssistantAdminClient({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<string>("all");
  const [busy, setBusy] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (filter === "all") return rows;
    if (filter === "ADV") return rows.filter((r) => r.is_advisory);
    return rows.filter((r) => r.entity_code === filter);
  }, [rows, filter]);

  function impersonate(r: Row) {
    setBusy(r.entity_code);
    const key = ENTITY_TO_KEY[r.entity_code] || "holdings";
    document.cookie = "fs_entity=" + key + "; path=/; max-age=31536000; SameSite=Lax";
    router.push("/administrate/settings/assistant");
  }

  return (
    <section className="mt-8">
      <div className="flex items-center gap-4">
        {FILTERS.map(([k, label]) => (
          <button key={k} onClick={() => setFilter(k)}
            className={"font-mono text-[10px] uppercase tracking-wide pb-0.5 " +
              (filter===k ? "text-ink border-b border-ink" : "text-clay border-b border-transparent hover:text-ink")}>
            {label}
          </button>
        ))}
      </div>

      <table className="mt-6 w-full border-collapse">
        <thead>
          <tr className="border-b border-black/20 font-mono text-[10px] uppercase tracking-wide text-clay">
            <th className="py-2 text-left font-normal">Profile</th>
            <th className="py-2 text-left font-normal">Tier</th>
            <th className="py-2 text-right font-normal">Actions MTD</th>
            <th className="py-2 text-right font-normal">Cost MTD</th>
            <th className="py-2 text-right font-normal">Channels</th>
            <th className="py-2 text-right font-normal">Playbooks</th>
            <th className="py-2 text-center font-normal">Brief</th>
            <th className="py-2 text-left font-normal">Last error</th>
            <th className="py-2 text-right font-normal">·</th>
          </tr>
        </thead>
        <tbody className="font-sans text-[13px] text-ink">
          {filtered.map((r) => {
            const actionsFrac = r.actions_cap ? Math.min(1, r.actions / r.actions_cap) : 0;
            const costFrac    = r.cost_cap_eur ? Math.min(1, r.cost_eur / r.cost_cap_eur) : 0;
            const hot = actionsFrac > 0.9 || costFrac > 0.9;
            return (
              <tr key={r.entity_code} className={"border-b border-black/5 " + (hot ? "bg-tomato/5" : "")}>
                <td className="py-3">
                  <p className="font-serif text-[15px] text-ink">{r.label}</p>
                  <p className="font-mono text-[10px] uppercase tracking-wide text-clay">{r.entity_code}</p>
                </td>
                <td className="py-3 font-mono text-[11px] text-ink capitalize">{r.tier}</td>
                <td className="py-3 text-right font-mono text-[12px]">
                  <span className="text-ink">{r.actions.toLocaleString("en-GB")}</span>
                  <span className="text-clay"> / {r.actions_cap.toLocaleString("en-GB")}</span>
                </td>
                <td className="py-3 text-right font-mono text-[12px]">
                  <span className="text-ink">€{r.cost_eur.toFixed(2)}</span>
                  <span className="text-clay"> / €{r.cost_cap_eur.toFixed(0)}</span>
                </td>
                <td className="py-3 text-right font-mono text-[12px] text-ink-soft">{r.channels}</td>
                <td className="py-3 text-right font-mono text-[12px] text-ink-soft">{r.playbooks}</td>
                <td className="py-3 text-center font-mono text-[10px]">
                  {r.brief_today ? <span className="text-basil">yes</span> : <span className="text-clay">—</span>}
                </td>
                <td className="py-3 font-mono text-[10px] text-tomato truncate max-w-[180px]">{r.last_error || ""}</td>
                <td className="py-3 text-right">
                  <div className="flex items-center justify-end gap-3">
                    <button
                      disabled={busy===r.entity_code}
                      onClick={() => impersonate(r)}
                      className="font-mono text-[10px] uppercase tracking-wide text-ink border-b border-ink/40 hover:border-ink pb-0.5">
                      {busy===r.entity_code ? "…" : "impersonate"}
                    </button>
                    <Link
                      href={"/administrate/holdings/console/assistant/usage/" + encodeURIComponent(r.entity_code)}
                      className="font-mono text-[10px] uppercase tracking-wide text-clay border-b border-transparent hover:text-ink hover:border-ink pb-0.5">
                      usage →
                    </Link>
                  </div>
                </td>
              </tr>
            );
          })}
          {filtered.length === 0 && (
            <tr>
              <td colSpan={9} className="py-12 text-center font-serif italic text-[15px] text-ink-soft">
                No profiles under this filter.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <p className="mt-8 font-serif italic text-[13px] text-ink-soft">
        Impersonate switches the top-of-page profile cookie; from that moment the Assistant surfaces see the world
        through that profile's eyes. It is a soft act — the RLS boundaries in Postgres do the harder work of keeping
        each profile's channels, playbooks and briefs apart.
      </p>
    </section>
  );
}
