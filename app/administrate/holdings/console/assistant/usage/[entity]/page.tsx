import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

// Per-profile usage detail. Reads the two aggregation views seeded in
// Sprint 6 #1 — v_assistant_usage_daily + v_assistant_usage_monthly — and
// composes an editorial breakdown: a daily sparkline (built with inline
// SVG so we don't take a chart-library dependency), a kind-mix table, and
// a per-user leaderboard.
export default async function AssistantUsageDetail(props: { params: { entity: string } }) {
  const entity = decodeURIComponent(props.params.entity || "").toUpperCase();
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user?.id) return (
    <main className="mx-auto max-w-4xl lg:max-w-6xl px-6 py-12">
      <p className="font-mono text-[10px] uppercase tracking-wide text-clay">sign in to view</p>
    </main>
  );

  // Read the last 30 days by day + kind.
  const since = new Date(); since.setDate(since.getDate() - 30);
  const sinceStr = since.toISOString().slice(0, 10);

  const [dailyRes, cfgRes, capRes] = await Promise.all([
    sb.from("v_assistant_usage_daily").select("*").eq("entity_code", entity).gte("day", sinceStr).order("day", { ascending: true }),
    sb.from("assistant_config").select("billing_tier").eq("entity_code", entity).maybeSingle(),
    sb.from("v_assistant_entity_mtd").select("actions,cost_eur,avg_latency_ms").eq("entity_code", entity).maybeSingle(),
  ]);

  const daily = dailyRes.data || [];
  const tierName = (cfgRes.data as any)?.billing_tier || "pro";
  const mtd = capRes.data as any;

  // Roll up: totals by day, by kind, by user.
  const byDay = new Map<string, { actions: number; cost: number }>();
  const byKind = new Map<string, { actions: number; cost: number }>();
  const byUser = new Map<string, { actions: number; cost: number }>();
  for (const r of daily as any[]) {
    const d = String(r.day).slice(0, 10);
    const dayEntry = byDay.get(d) || { actions: 0, cost: 0 };
    dayEntry.actions += Number(r.actions || 0); dayEntry.cost += Number(r.cost_eur || 0);
    byDay.set(d, dayEntry);
    const k = String(r.action_kind || "other");
    const ke = byKind.get(k) || { actions: 0, cost: 0 };
    ke.actions += Number(r.actions || 0); ke.cost += Number(r.cost_eur || 0);
    byKind.set(k, ke);
    const uk = String(r.user_id || "system");
    const ue = byUser.get(uk) || { actions: 0, cost: 0 };
    ue.actions += Number(r.actions || 0); ue.cost += Number(r.cost_eur || 0);
    byUser.set(uk, ue);
  }
  const daySeries = Array.from(byDay.entries()).sort(([a],[b]) => a.localeCompare(b));
  const maxActions = Math.max(1, ...daySeries.map(([, v]) => v.actions));

  const kindRows = Array.from(byKind.entries()).sort((a,b) => b[1].actions - a[1].actions);
  const userRows = Array.from(byUser.entries()).sort((a,b) => b[1].actions - a[1].actions).slice(0, 5);

  // Look up display name for advisory codes.
  let displayName = entity;
  if (entity.startsWith("ADV-")) {
    const { data: a } = await sb.from("assistant_advisory_clients").select("name").eq("entity_code", entity).maybeSingle();
    if (a?.name) displayName = a.name + " (" + entity + ")";
  }

  return (
    <main className="mx-auto max-w-4xl lg:max-w-6xl px-6 py-12">
      <Link href="/administrate/holdings/console/assistant" className="font-mono text-[10px] uppercase tracking-wide text-clay">← Assistant overview</Link>
      <p className="mt-6 font-mono text-[10px] uppercase tracking-wide text-clay">Assistant usage · {tierName} tier</p>
      <h1 className="mt-2 font-serif text-[32px] leading-[1.05] text-ink">{displayName}</h1>
      <p className="mt-3 font-serif italic text-[15px] text-ink-soft">
        The last thirty days on this profile — how much the Assistant did, how much it spent, and where the effort
        went. All numbers in Europe/Madrid days.
      </p>

      <section className="mt-8">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Month to date</p>
        <div className="mt-3 flex items-baseline gap-8">
          <div>
            <p className="font-serif text-[28px] text-ink leading-none">{Number(mtd?.actions || 0).toLocaleString("en-GB")}</p>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-clay">actions</p>
          </div>
          <div>
            <p className="font-serif text-[28px] text-ink leading-none">€{Number(mtd?.cost_eur || 0).toFixed(2)}</p>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-clay">model cost</p>
          </div>
          <div>
            <p className="font-serif text-[28px] text-ink leading-none">{Number(mtd?.avg_latency_ms || 0)} ms</p>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-clay">avg latency</p>
          </div>
        </div>
      </section>

      <section className="mt-10">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Daily actions · last 30 days</p>
        {daySeries.length === 0 ? (
          <p className="mt-3 font-serif italic text-[14px] text-ink-soft">Nothing recorded yet. The chart appears once the Assistant runs on this profile.</p>
        ) : (
          <svg viewBox="0 0 600 120" className="mt-3 w-full h-32 block">
            {daySeries.map(([day, v], i) => {
              const w = 600 / daySeries.length;
              const h = (v.actions / maxActions) * 100;
              return (
                <g key={day}>
                  <rect x={i * w + 1} y={110 - h} width={Math.max(1, w - 2)} height={h} className="fill-ink/70" />
                </g>
              );
            })}
            <line x1="0" x2="600" y1="110" y2="110" className="stroke-black/20" strokeWidth="1" />
          </svg>
        )}
      </section>

      <section className="mt-10">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Breakdown by kind</p>
        <table className="mt-3 w-full border-collapse">
          <thead>
            <tr className="border-b border-black/20 font-mono text-[10px] uppercase tracking-wide text-clay">
              <th className="py-2 text-left font-normal">Kind</th>
              <th className="py-2 text-right font-normal">Actions</th>
              <th className="py-2 text-right font-normal">Cost</th>
            </tr>
          </thead>
          <tbody className="font-sans text-[13px] text-ink">
            {kindRows.map(([k, v]) => (
              <tr key={k} className="border-b border-black/5">
                <td className="py-2 font-mono text-[11px] uppercase tracking-wide text-ink">{k}</td>
                <td className="py-2 text-right font-mono text-[12px]">{v.actions.toLocaleString("en-GB")}</td>
                <td className="py-2 text-right font-mono text-[12px]">€{v.cost.toFixed(2)}</td>
              </tr>
            ))}
            {kindRows.length === 0 && (
              <tr><td colSpan={3} className="py-6 text-center font-serif italic text-[14px] text-ink-soft">No activity yet.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="mt-10">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Top users</p>
        <table className="mt-3 w-full border-collapse">
          <thead>
            <tr className="border-b border-black/20 font-mono text-[10px] uppercase tracking-wide text-clay">
              <th className="py-2 text-left font-normal">User</th>
              <th className="py-2 text-right font-normal">Actions</th>
              <th className="py-2 text-right font-normal">Cost</th>
            </tr>
          </thead>
          <tbody className="font-sans text-[13px] text-ink">
            {userRows.map(([uid, v]) => (
              <tr key={uid} className="border-b border-black/5">
                <td className="py-2 font-mono text-[11px] text-ink truncate max-w-[280px]">{uid.slice(0, 8)}…</td>
                <td className="py-2 text-right font-mono text-[12px]">{v.actions.toLocaleString("en-GB")}</td>
                <td className="py-2 text-right font-mono text-[12px]">€{v.cost.toFixed(2)}</td>
              </tr>
            ))}
            {userRows.length === 0 && (
              <tr><td colSpan={3} className="py-6 text-center font-serif italic text-[14px] text-ink-soft">No operators on this profile yet.</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}
