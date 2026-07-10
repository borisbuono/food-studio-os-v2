import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";
import AssistantAdminClient from "./AssistantAdminClient";

export const dynamic = "force-dynamic";

// Holdings-level view over the Assistant Layer.
// One row per configured profile — the internal group and every advisory
// client. Shows month-to-date actions, month-to-date cost, connected
// channels, playbooks, whether a brief has landed today, and the last
// error the orchestrator logged for that profile.
export default async function HoldingsAssistantAdmin() {
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const uid = u.user?.id || null;
  if (!uid) return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <p className="font-mono text-[10px] uppercase tracking-wide text-clay">sign in to view</p>
    </main>
  );

  const today = new Date().toISOString().slice(0, 10);

  const [configsRes, tiersRes, advRes, mtdRes, chansRes, pbsRes, briefsRes, errRes] = await Promise.all([
    sb.from("assistant_config").select("entity_code,billing_tier,voice_profile"),
    sb.from("assistant_billing_tiers").select("name,monthly_action_cap,monthly_cost_cap_eur"),
    sb.from("assistant_advisory_clients").select("entity_code,name").eq("is_active", true),
    sb.from("v_assistant_entity_mtd").select("entity_code,actions,cost_eur,avg_latency_ms"),
    // channels — count of active channels the current user has for each
    // entity is not really per-entity in schema; we count the user's total
    // as a proxy. Advisory-client channel isolation improves in a follow-up.
    sb.from("assistant_channels").select("id,channel_type").is("revoked_at", null),
    sb.from("assistant_playbooks").select("entity_code"),
    sb.from("assistant_briefs").select("entity_code").eq("date", today).eq("user_id", uid),
    sb.from("assistant_actions").select("entity_code,payload,created_at").ilike("action_type","%error%").order("created_at",{ ascending: false }).limit(20),
  ]);

  const configs = configsRes.data || [];
  const tiers   = tiersRes.data   || [];
  const adv     = advRes.data     || [];
  const mtd     = new Map<string, any>((mtdRes.data || []).map((r: any) => [r.entity_code, r]));
  const chanCount = (chansRes.data || []).length;
  const pbByEnt = new Map<string, number>();
  for (const r of (pbsRes.data || [])) pbByEnt.set(r.entity_code, (pbByEnt.get(r.entity_code) || 0) + 1);
  const briefToday = new Set((briefsRes.data || []).map((r: any) => r.entity_code));
  const lastError = new Map<string, string>();
  for (const r of (errRes.data || [])) {
    if (r.entity_code && !lastError.has(r.entity_code)) {
      lastError.set(r.entity_code, String((r.payload as any)?.error || (r.payload as any)?.message || "error"));
    }
  }
  const tierMap = new Map<string, any>(tiers.map((t: any) => [t.name, t]));
  const advNameMap = new Map<string, string>(adv.map((a: any) => [a.entity_code, a.name]));

  const rows = configs.map((c: any) => {
    const m = mtd.get(c.entity_code) || { actions: 0, cost_eur: 0, avg_latency_ms: 0 };
    const tier = tierMap.get(c.billing_tier || "pro") || { monthly_action_cap: 0, monthly_cost_cap_eur: 0 };
    const label = c.entity_code.startsWith("ADV-")
      ? (advNameMap.get(c.entity_code) || c.entity_code)
      : c.entity_code;
    return {
      entity_code: c.entity_code,
      label,
      is_advisory: c.entity_code.startsWith("ADV-"),
      tier: c.billing_tier || "pro",
      actions:  Number(m.actions  || 0),
      cost_eur: Number(m.cost_eur || 0),
      actions_cap: Number(tier.monthly_action_cap || 0),
      cost_cap_eur: Number(tier.monthly_cost_cap_eur || 0),
      channels: chanCount,
      playbooks: pbByEnt.get(c.entity_code) || 0,
      brief_today: briefToday.has(c.entity_code),
      last_error: lastError.get(c.entity_code) || null,
    };
  }).sort((a: any, b: any) => a.entity_code.localeCompare(b.entity_code));

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <Link href="/administrate/holdings/console" className="font-mono text-[10px] uppercase tracking-wide text-clay">← Holdings</Link>
      <p className="mt-6 font-mono text-[10px] uppercase tracking-wide text-clay">Holdings · The Brain across the group</p>
      <h1 className="mt-2 font-serif text-[34px] leading-[1.05] text-ink">Assistant Layer, at a glance.</h1>
      <p className="mt-3 font-serif italic text-[15px] text-ink-soft">
        One row for every profile — the three inside the group and every advisory client we run. Actions and cost are
        month-to-date. Impersonate a profile to look at the day through its eyes; open its usage to see the shape of
        the month.
      </p>

      <AssistantAdminClient rows={rows} />
    </main>
  );
}
