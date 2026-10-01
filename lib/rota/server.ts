// lib/rota/server.ts — shared server helpers for the rota module (S1–S4).
//
// Everything here runs with the caller's own session (RLS applies); the SQL
// functions in supabase/migrations/20261001_rota_*.sql do the arithmetic.
// Nothing in this file writes to `observations` — staff data is the smallest
// circle (Foundation §5).

import { supabaseServer } from "@/lib/supabaseServer";

export type RotaShift = {
  id: string; entity_id: string; person_id: string; service_date: string;
  start_time: string; end_time: string; role: string | null; station: string | null;
  area: "foh" | "boh" | "other"; planned_minutes: number; hourly_cost: number | null;
  status: "planned" | "published" | "cancelled"; notes: string | null;
};
export type RotaPerson = { id: string; name: string | null; role: string | null; auth_user_id: string | null; rate: number | null };
export type RotaWeekRow = { id: string; week_start: string; budget_eur: number | null; budget_pct: number | null; forecast_revenue: number | null; status: "draft" | "published"; published_at: string | null } | null;
export type RotaCost = { planned_minutes: number; planned_eur: number; shifts: number; unpriced: number; foh_minutes: number; boh_minutes: number };
export type RotaSettings = { overtime_rate: number; tolerance_minutes: number; default_budget_pct: number | null; staffing_bands: Array<{ max_covers: number; foh: number; boh: number }> };

export function mondayOf(iso: string): string {
  const d = new Date(iso + "T12:00:00Z");
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}
export function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function isIsoDate(s: unknown): s is string { return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s); }

export async function requireUser() {
  const sb = supabaseServer();
  const { data } = await sb.auth.getUser();
  return { sb, uid: data.user?.id || null };
}

export async function isManager(sb: ReturnType<typeof supabaseServer>, uid: string, entity_id: string): Promise<boolean> {
  const { data } = await sb.rpc("fn_is_entity_manager", { uid, ent: entity_id });
  return Boolean(data);
}

// Active people of an entity with their current rate (person_id-first, auth fallback).
export async function loadPeople(sb: ReturnType<typeof supabaseServer>, entity_id: string, asOf: string): Promise<RotaPerson[]> {
  const { data: ms } = await sb.from("memberships").select("person_id, role").eq("entity_id", entity_id).eq("status", "active");
  const ids = Array.from(new Set((ms || []).map((m: any) => m.person_id as string)));
  if (!ids.length) return [];
  const roleBy = new Map<string, string | null>();
  for (const m of ms || []) roleBy.set((m as any).person_id, (m as any).role || null);
  const { data: tms } = await sb.from("team_members").select("id, name, default_role, auth_user_id, status").in("id", ids);
  const people = ((tms || []) as any[]).filter((t) => t.status !== "archived");
  const rates = await Promise.all(people.map((p) => sb.rpc("fn_person_rate", { p_entity: entity_id, p_person: p.id, p_date: asOf }).then((r) => (r.data == null ? null : Number(r.data)))));
  return people.map((p, i) => ({ id: p.id, name: p.name || null, role: roleBy.get(p.id) || p.default_role || null, auth_user_id: p.auth_user_id || null, rate: rates[i] }))
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}

export async function loadWeek(sb: ReturnType<typeof supabaseServer>, entity_id: string, week_start: string) {
  const week_end = addDays(week_start, 7);
  const [shiftsRes, weekRes, costRes, settingsRes, prevRes] = await Promise.all([
    sb.from("rota_shifts").select("id, entity_id, person_id, service_date, start_time, end_time, role, station, area, planned_minutes, hourly_cost, status, notes")
      .eq("entity_id", entity_id).gte("service_date", week_start).lt("service_date", week_end).neq("status", "cancelled").order("service_date").order("start_time"),
    sb.from("rota_weeks").select("id, week_start, budget_eur, budget_pct, forecast_revenue, status, published_at").eq("entity_id", entity_id).eq("week_start", week_start).maybeSingle(),
    sb.rpc("fn_rota_week_cost", { p_entity: entity_id, p_week_start: week_start }),
    sb.rpc("fn_rota_settings", { p_entity: entity_id }),
    sb.from("rota_shifts").select("id", { count: "exact", head: true }).eq("entity_id", entity_id).gte("service_date", addDays(week_start, -7)).lt("service_date", week_start).neq("status", "cancelled"),
  ]);
  const costRow = Array.isArray(costRes.data) ? costRes.data[0] : costRes.data;
  const cost: RotaCost = {
    planned_minutes: Number(costRow?.planned_minutes || 0), planned_eur: Number(costRow?.planned_eur || 0), shifts: Number(costRow?.shifts || 0),
    unpriced: Number(costRow?.unpriced || 0), foh_minutes: Number(costRow?.foh_minutes || 0), boh_minutes: Number(costRow?.boh_minutes || 0),
  };
  const s = (Array.isArray(settingsRes.data) ? settingsRes.data[0] : settingsRes.data) as any;
  const settings: RotaSettings = {
    overtime_rate: Number(s?.overtime_rate ?? 1.25), tolerance_minutes: Number(s?.tolerance_minutes ?? 10),
    default_budget_pct: s?.default_budget_pct == null ? null : Number(s.default_budget_pct), staffing_bands: Array.isArray(s?.staffing_bands) ? s.staffing_bands : [],
  };
  return {
    shifts: (shiftsRes.data || []) as RotaShift[],
    week: (weekRes.data as RotaWeekRow) || null,
    cost, settings,
    last_week_has_shifts: Number(prevRes.count || 0) > 0,
  };
}
