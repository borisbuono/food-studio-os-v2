import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// /api/events/rebuild?source=all|shift|booking|…&entity=<uuid>[&from=ISO&to=ISO]
// Manual repair of the calendar overlay. Runs refresh_events() as the signed-in
// user; the RPC refuses anyone who is not a manager of that entity (42501).
// Real-time sync is DB triggers; nightly catch-up is pg_cron 'events-nightly'.
const SOURCES = new Set([
  "all", "shift", "booking", "interview", "task", "social", "sales_event", "prep", "haccp", "commercial",
]);

async function run(req: Request) {
  const url = new URL(req.url);
  const source = url.searchParams.get("source") || "all";
  const entity = url.searchParams.get("entity") || "";
  if (!SOURCES.has(source)) return Response.json({ ok: false, error: "unknown source" }, { status: 400 });
  if (!/^[0-9a-f-]{36}$/i.test(entity)) return Response.json({ ok: false, error: "entity uuid required" }, { status: 400 });
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user?.id) return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const args: Record<string, string> = { p_source: source, p_entity: entity };
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (from) args.p_from = from;
  if (to) args.p_to = to;
  const { data, error } = await sb.rpc("refresh_events", args);
  if (error) {
    const status = error.code === "42501" ? 403 : 500;
    return Response.json({ ok: false, error: error.message }, { status });
  }
  return Response.json({ ok: true, upserted: data });
}

export const GET = run;
export const POST = run;
