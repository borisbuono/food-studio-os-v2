import { supabaseJob, hasServiceRole } from "@/lib/supabaseJob";
import { syncPerson, type GcalTokens } from "@/lib/calendarGoogle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Nightly Google pull for everyone connected. Needs SUPABASE_SERVICE_ROLE_KEY
// (token table is not readable otherwise) — returns 503 until it is set.
// Not yet in vercel.json: interactive pulls (on opening /me/calendar, and
// before /book availability) cover v1. Add the cron line once the key is on Vercel.
export async function GET(req: Request) {
  const auth = req.headers.get("authorization") || "";
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`)
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!hasServiceRole()) return Response.json({ ok: false, error: "SUPABASE_SERVICE_ROLE_KEY not set" }, { status: 503 });
  const sb = supabaseJob();
  const { data, error } = await sb.from("google_calendar_tokens")
    .select("person_id, refresh_token, access_token, access_expires_at, last_synced_at");
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  const results = [];
  for (const t of (data || []) as GcalTokens[]) results.push({ person: t.person_id, ...(await syncPerson(sb, t)) });
  return Response.json({ ok: true, results });
}
