import type { NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { supabaseService } from "@/lib/supabaseService";

// Shared cron plumbing.
//
// Why this exists (walk 2026-09-21): the nightly Fresto sync could not be
// proven to run. Its only trace was an assistant_actions insert wrapped in a
// bare try/catch, and that table held zero pos_sync rows — indistinguishable
// from "ran and wrote nothing". cron_runs records the attempt BEFORE any work
// happens, so a run that dies mid-flight still leaves a row. v_cron_health
// shows the last run per job.
//
// It also hands every cron route the SERVICE-ROLE client. This is the other
// half of the 2026-09-21 finding: the Fresto routes all ran on
// supabaseServer(), the cookie-bound ANON client. A request authenticated by
// CRON_SECRET carries no cookie, so RLS returned zero rows and every write
// touched nothing — silently, with ok:true. lib/supabaseService.ts already
// existed for exactly this reason (the recipes cron hit it first); the POS
// lane never adopted it. Proof: the first eod-accounting-rebuild call read
// pos_days:0 for both venues against 485 BM rows that are demonstrably there.

export async function cronAuthorized(req: NextRequest): Promise<{ ok: boolean; who: string }> {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") || "";
  if (secret && auth === `Bearer ${secret}`) return { ok: true, who: "cron_secret" };
  if (!secret) return { ok: true, who: "no_secret_set" };
  const sb = supabaseServer();
  const { data } = await sb.auth.getUser();
  if (data?.user) return { ok: true, who: "user:" + (data.user.email || data.user.id) };
  return { ok: false, who: "anon" };
}

// The client every cron job should use. Falls back to the session client so
// local dev still works, and says which one it got so a route can report
// "skipped: no service key" instead of pretending to have run.
export function cronDb(): { sb: any; mode: "service" | "session" } {
  const svc = supabaseService();
  return svc ? { sb: svc, mode: "service" } : { sb: supabaseServer(), mode: "session" };
}

export async function startRun(job: string, triggered_by: string, detail?: any): Promise<string | null> {
  try {
    const { sb } = cronDb();
    const r = await sb.from("cron_runs").insert({ job, triggered_by, detail: detail ?? null }).select("id").single();
    return r.data?.id ?? null;
  } catch { return null; }
}

export async function finishRun(id: string | null, ok: boolean, detail?: any, error?: string | null) {
  if (!id) return;
  try {
    const { sb } = cronDb();
    await sb.from("cron_runs")
      .update({ finished_at: new Date().toISOString(), ok, detail: detail ?? null, error: error ?? null })
      .eq("id", id);
  } catch { /* heartbeat failures must never fail the job */ }
}
