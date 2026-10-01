// lib/chef/rota.ts — Chef readers for the rota module (rota S4, 2026-10-01).
//
// Three questions, three cards: "quién trabaja hoy" (rota_today), "horas extra
// pendientes" (overtime_pending → the queue), "coste de personal esta semana"
// (labour_week). All reads; the only write path for labour stays the Labour
// tab's queue (ruling 3). Staff rows are read with the caller's own session, so
// RLS decides what a non-manager sees.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChefCard, ChefLang } from "@/lib/chef/types";

export type RotaReadScope = { entity_id: string; entity_name: string; house: string | null; tz: string };

function tzDate(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
export function mondayOf(iso: string): string {
  const d = new Date(iso + "T12:00:00Z"); const k = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - k); return d.toISOString().slice(0, 10);
}
const hm = (t: string) => String(t || "").slice(0, 5);
const mins = (m: number) => (m >= 60 ? Math.floor(m / 60) + "h" + (m % 60 ? String(m % 60).padStart(2, "0") : "") : m + "m");
const eur = (n: number) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);

export async function readRotaToday(sb: SupabaseClient, s: RotaReadScope, lang: ChefLang): Promise<{ card: ChefCard; say: string }> {
  const es = lang === "es";
  const today = tzDate(s.tz);
  const href = s.house ? `/h/${s.house}/team?tab=rota` : "/studio/people";
  const { data } = await sb.from("rota_shifts").select("person_id, start_time, end_time, role, area, status").eq("entity_id", s.entity_id).eq("service_date", today).neq("status", "cancelled").order("start_time");
  const rows = (data || []) as any[];
  if (!rows.length) {
    const t = es ? "Nadie en el cuadrante hoy" : "Nobody on the rota today";
    return { say: t, card: { title: t, lines: [today], kind: "read", entity_label: s.entity_name, href, primary: { label: es ? "Abrir cuadrante" : "Open rota", kind: "navigate", href } } };
  }
  const ids = Array.from(new Set(rows.map((r) => r.person_id)));
  const { data: tms } = await sb.from("team_members").select("id, name").in("id", ids);
  const name = (id: string) => ((tms || []) as any[]).find((t) => t.id === id)?.name || "—";
  const foh = rows.filter((r) => r.area === "foh").length, boh = rows.filter((r) => r.area === "boh").length;
  const title = es ? `${rows.length} en turno hoy · ${foh} sala, ${boh} cocina` : `${rows.length} on today · ${foh} FOH, ${boh} BOH`;
  const lines = rows.slice(0, 4).map((r) => `${hm(r.start_time)}–${hm(r.end_time)} ${name(r.person_id)}${r.role ? " · " + r.role : ""}${r.status === "planned" ? (es ? " (borrador)" : " (draft)") : ""}`);
  const first = rows[0];
  const say = title + (es ? `. Primero ${name(first.person_id)} a las ${hm(first.start_time)}` : `. First in ${name(first.person_id)} at ${hm(first.start_time)}`);
  return { say, card: { title, lines, kind: "read", entity_label: s.entity_name, href, primary: { label: es ? "Abrir cuadrante" : "Open rota", kind: "navigate", href } } };
}

export async function readOvertimePending(sb: SupabaseClient, s: RotaReadScope, lang: ChefLang): Promise<{ card: ChefCard; say: string; count: number }> {
  const es = lang === "es";
  const href = s.house ? `/h/${s.house}/team?tab=labour` : "/studio/people";
  const { data } = await sb.from("shift_settlements").select("person_id, service_date, kind, overtime_minutes, undertime_minutes, overtime_status, undertime_status, hourly_cost, overtime_rate")
    .eq("entity_id", s.entity_id).or("overtime_status.eq.pending,undertime_status.eq.pending").order("service_date", { ascending: false }).limit(50);
  const rows = (data || []) as any[];
  if (!rows.length) {
    const t = es ? "Sin horas extra pendientes" : "No overtime waiting";
    return { count: 0, say: t, card: { title: t, lines: [es ? "La cola está vacía" : "The queue is empty"], kind: "read", entity_label: s.entity_name, href, primary: { label: es ? "Abrir cola" : "Open queue", kind: "navigate", href } } };
  }
  const ids = Array.from(new Set(rows.map((r) => r.person_id).filter(Boolean)));
  const { data: tms } = ids.length ? await sb.from("team_members").select("id, name").in("id", ids) : { data: [] as any[] };
  const name = (id: string) => ((tms || []) as any[]).find((t) => t.id === id)?.name || "—";
  const otMin = rows.reduce((n, r) => n + (r.overtime_status === "pending" ? Number(r.overtime_minutes) : 0), 0);
  const otEur = rows.reduce((n, r) => n + (r.overtime_status === "pending" && r.hourly_cost != null ? (Number(r.overtime_minutes) / 60) * Number(r.hourly_cost) * Number(r.overtime_rate) : 0), 0);
  const title = es ? `${rows.length} por aprobar · ${mins(otMin)} extra (${eur(otEur)} si apruebas todo)` : `${rows.length} to approve · ${mins(otMin)} overtime (${eur(otEur)} if all approved)`;
  const lines = rows.slice(0, 4).map((r) => `${r.service_date.slice(5)} ${name(r.person_id)} · ${r.kind === "no_show" ? (es ? "no fichó" : "no-show") : r.kind === "unplanned" ? (es ? "sin turno" : "unplanned") : ""}${r.overtime_status === "pending" ? " +" + mins(r.overtime_minutes) : ""}${r.undertime_status === "pending" ? " −" + mins(r.undertime_minutes) : ""}`);
  const say = es ? `${rows.length} horas extra por aprobar, ${mins(otMin)} en total` : `${rows.length} overtime rows to approve, ${mins(otMin)} in total`;
  return { count: rows.length, say, card: { title, lines, kind: "read", entity_label: s.entity_name, href, primary: { label: es ? "Abrir cola" : "Open queue", kind: "navigate", href } } };
}

export async function readLabourWeek(sb: SupabaseClient, s: RotaReadScope, lang: ChefLang): Promise<{ card: ChefCard; say: string }> {
  const es = lang === "es";
  const week = mondayOf(tzDate(s.tz));
  const href = s.house ? `/h/${s.house}/team?tab=labour` : "/studio/people";
  const [{ data: l }, { data: w }] = await Promise.all([
    sb.rpc("fn_rota_week_labour", { p_entity: s.entity_id, p_week_start: week }),
    sb.from("rota_weeks").select("budget_eur, budget_pct, forecast_revenue").eq("entity_id", s.entity_id).eq("week_start", week).maybeSingle(),
  ]);
  const r = (Array.isArray(l) ? l[0] : l) as any;
  if (!r) {
    const t = es ? "Sin datos de personal esta semana" : "No labour data this week";
    return { say: t, card: { title: t, lines: [week], kind: "read", entity_label: s.entity_name, href } };
  }
  const labour = Number(r.labour_eur || 0), pct = r.labour_pct == null ? null : Number(r.labour_pct);
  const budget = w?.budget_eur != null ? Number(w.budget_eur) : w?.budget_pct != null && w?.forecast_revenue != null ? (Number(w.budget_pct) / 100) * Number(w.forecast_revenue) : null;
  const title = es ? `Personal esta semana: ${eur(labour)}${pct != null ? ` · ${pct} % de la venta` : ""}` : `Labour this week: ${eur(labour)}${pct != null ? ` · ${pct} % of revenue` : ""}`;
  const lines = [
    es ? `Liquidado ${eur(Number(r.settled_eur))} · planificado ${eur(Number(r.planned_eur))}` : `Settled ${eur(Number(r.settled_eur))} · still planned ${eur(Number(r.planned_eur))}`,
    es ? `Horas extra pagadas ${eur(Number(r.overtime_eur))} · ${r.pending} pendientes` : `Overtime paid ${eur(Number(r.overtime_eur))} · ${r.pending} pending`,
    budget != null ? (es ? `Presupuesto ${eur(budget)} · ${labour > budget ? "+" : ""}${eur(labour - budget)}` : `Budget ${eur(budget)} · ${labour > budget ? "+" : ""}${eur(labour - budget)}`) : (es ? "Sin presupuesto fijado" : "No budget set"),
  ];
  const say = title + (budget != null ? (es ? (labour > budget ? ", por encima del presupuesto" : ", dentro del presupuesto") : (labour > budget ? ", over budget" : ", within budget")) : "");
  return { say, card: { title, lines, kind: "read", entity_label: s.entity_name, href, primary: { label: es ? "Abrir personal" : "Open labour", kind: "navigate", href } } };
}
