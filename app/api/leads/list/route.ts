// GET /api/leads/list?entity=<id>&state=<state>&limit=<n>&offset=<n>
//
// Auth-gated (middleware wall). Returns a paged list of leads, filtered by
// entity_id and/or state. Default 50 per page, cap 200.

import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const sb = supabaseServer();
  const { data: userRes } = await sb.auth.getUser();
  if (!userRes?.user) {
    return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }

  const url = new URL(req.url);
  const entity = url.searchParams.get("entity");
  const state  = url.searchParams.get("state");
  const limit  = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") || 50)));
  const offset = Math.max(0, Number(url.searchParams.get("offset") || 0));

  let q = sb.from("leads")
    .select("id, entity_id, source, name, email, phone, party_size, intent, requested_date, message, state, created_at, updated_at, assigned_to, utm_source, utm_medium, utm_campaign, landing_url, referrer_url", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (entity && /^[0-9a-f-]{36}$/i.test(entity)) q = q.eq("entity_id", entity);
  if (state) q = q.eq("state", state);

  const { data, error, count } = await q;
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true, rows: data || [], count: count ?? null, limit, offset });
}
