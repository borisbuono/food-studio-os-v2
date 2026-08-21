import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";
import { serverEntity } from "@/lib/serverVenue";
import { EntityKey } from "@/lib/entities";
import AuditClient from "./AuditClient";

export const dynamic = "force-dynamic";

const ENTITY_CODE: Record<EntityKey, "IFL" | "BM" | "BBH"> = {
  holdings: "BBH", bistro_mondo: "BM", taller: "IFL",
};

// Assistant Polish #3 — action audit surface.
// Every assistant_actions row for the current entity (last 30 days),
// with a daily count/cost sparkline and per-row expand. Server-rendered
// for the aggregate view; interactive drill-in via the client.
export default async function AssistantAuditPage() {
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const uid = u.user?.id || null;
  if (!uid) return (
    <main className="mx-auto max-w-4xl lg:max-w-6xl px-6 py-12">
      <p className="font-mono text-[10px] uppercase tracking-wide text-clay">sign in to view</p>
    </main>
  );

  const entity = serverEntity();
  const ec = ENTITY_CODE[entity];
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [actionsRes, dailyRes] = await Promise.all([
    sb.from("assistant_actions")
      .select("id,action_type,action_kind,entity_code,cost_eur,latency_ms,model,input_tokens,output_tokens,payload,created_at,target_table,target_id")
      .eq("entity_code", ec)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(500),
    sb.from("v_assistant_usage_daily")
      .select("day,action_kind,actions,cost_eur")
      .eq("entity_code", ec)
      .gte("day", since.slice(0, 10))
      .order("day", { ascending: true }),
  ]);

  const actions = (actionsRes.data || []) as any[];
  const daily = (dailyRes.data || []) as any[];

  // Roll up daily.
  const byDay = new Map<string, { actions: number; cost: number }>();
  for (const r of daily) {
    const d = String(r.day).slice(0, 10);
    const e = byDay.get(d) || { actions: 0, cost: 0 };
    e.actions += Number(r.actions || 0);
    e.cost    += Number(r.cost_eur || 0);
    byDay.set(d, e);
  }
  const daySeries = Array.from(byDay.entries()).sort(([a], [b]) => a.localeCompare(b));
  const maxActions = Math.max(1, ...daySeries.map(([, v]) => v.actions));
  const totalActions = daySeries.reduce((a, [, v]) => a + v.actions, 0);
  const totalCost    = daySeries.reduce((a, [, v]) => a + v.cost,    0);

  return (
    <main className="mx-auto max-w-4xl lg:max-w-6xl px-6 py-12">
      <Link href="/administrate/settings/assistant" className="font-mono text-[10px] uppercase tracking-wide text-clay">← Assistant</Link>
      <p className="mt-6 font-mono text-[10px] uppercase tracking-wide text-clay">Audit · {ec}</p>
      <h1 className="mt-2 font-serif text-[34px] leading-[1.05] text-ink">What the Assistant did</h1>
      <p className="mt-3 font-serif italic text-[15px] text-ink-soft">
        Every action on this profile in the last thirty days — chats, briefs, drafts, triage runs. Cost, latency, and
        the exact payload sent to the model. Click a row to see the request.
      </p>

      <section className="mt-8 flex items-baseline gap-10">
        <div>
          <p className="font-serif text-[28px] text-ink leading-none">{totalActions.toLocaleString("en-GB")}</p>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-clay">actions · 30 days</p>
        </div>
        <div>
          <p className="font-serif text-[28px] text-ink leading-none">€{totalCost.toFixed(2)}</p>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-clay">model spend · 30 days</p>
        </div>
        <div>
          <p className="font-serif text-[28px] text-ink leading-none">{actions.length}</p>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-clay">rows shown</p>
        </div>
      </section>

      <section className="mt-8">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Daily actions</p>
        {daySeries.length === 0 ? (
          <p className="mt-3 font-serif italic text-[14px] text-ink-soft">Nothing recorded yet. Once the Assistant runs, the chart appears here.</p>
        ) : (
          <svg viewBox="0 0 600 120" className="mt-3 block h-32 w-full">
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

      <AuditClient actions={actions} />
    </main>
  );
}
