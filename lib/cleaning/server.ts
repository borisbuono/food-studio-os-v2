// lib/cleaning/server.ts — server-side reads for the cleaning module.
//
// Every read goes through the CALLER's session (RLS decides what a member
// sees); the one definer call is fn_cleaning_materialise, so a cook opening
// the page before the 04:50 UTC job still finds today's lists. Idempotent.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CleaningRun, CleaningRunItem } from "@/lib/cleaning/types";
import { SHIFT_ORDER } from "@/lib/cleaning/types";

export function isUuid(x: unknown): x is string {
  return typeof x === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
}
export function isIsoDate(x: unknown): x is string {
  return typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x);
}
export function tzToday(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export async function loadRuns(sb: SupabaseClient, entityId: string, from: string, to: string, opts?: { materialise?: boolean; area?: string | null }): Promise<CleaningRun[]> {
  if (opts?.materialise) {
    // Only today can be materialised (the function derives nothing else); any
    // error here is non-fatal — the lists that exist still show.
    try { await sb.rpc("fn_cleaning_materialise", { p_entity: entityId, p_date: from }); } catch { /* ignore */ }
  }
  let q = sb.from("cleaning_runs").select("*").eq("entity_id", entityId).gte("service_date", from).lte("service_date", to);
  if (opts?.area) q = q.eq("area", opts.area);
  const { data: runs, error } = await q.order("service_date", { ascending: false }).order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  const rs = (runs || []) as any[];
  if (!rs.length) return [];
  const ids = rs.map((r) => r.id);
  const { data: items, error: e2 } = await sb.from("cleaning_run_items").select("*").in("run_id", ids).order("sort_order", { ascending: true }).order("created_at", { ascending: true });
  if (e2) throw new Error(e2.message);
  const byRun = new Map<string, CleaningRunItem[]>();
  for (const it of (items || []) as any[]) (byRun.get(it.run_id) || byRun.set(it.run_id, []).get(it.run_id))!.push(it as CleaningRunItem);
  const out: CleaningRun[] = rs.map((r) => ({ ...(r as any), items: byRun.get(r.id) || [] }));
  out.sort((a, b) => a.service_date === b.service_date
    ? SHIFT_ORDER.indexOf(a.shift) - SHIFT_ORDER.indexOf(b.shift) || a.template_name.localeCompare(b.template_name)
    : a.service_date < b.service_date ? 1 : -1);
  return out;
}

export async function loadToday(sb: SupabaseClient, entityId: string, date: string): Promise<CleaningRun[]> {
  return loadRuns(sb, entityId, date, date, { materialise: true });
}

// Open items today, for chips / wall / Chef — one number, honest per RLS.
export async function countOpenToday(sb: SupabaseClient, entityId: string, date: string): Promise<{ open: number; total: number; runs_open: number; closing_unsigned: boolean }> {
  const runs = await loadRuns(sb, entityId, date, date);
  let open = 0, total = 0, runs_open = 0, closing_unsigned = false;
  for (const r of runs) {
    total += r.items.length;
    open += r.items.filter((i) => !i.done).length;
    if (r.status !== "signed") { runs_open += 1; if (r.shift === "closing") closing_unsigned = true; }
  }
  return { open, total, runs_open, closing_unsigned };
}
