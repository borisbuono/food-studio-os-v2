import { supabaseServer } from "@/lib/supabaseServer";
import { resolveEntityScope } from "@/lib/assistant/orchestrator";
import { getMyMembershipContext } from "@/lib/memberships";
import { predictChips } from "@/lib/chef/predict";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// /api/chef/chips — Chef v3 Phase 2 S4, predictive idle chips.
//
// GET  ?entity=<uuid>&route=<path>&lang=es|en → { chips, impression_id }
//      and one chef_chip_log row (what was shown) so taps can be measured.
// POST { impression_id, tapped } → marks the tap on that impression.

const NO_STORE = { "cache-control": "no-store" };

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: NO_STORE });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const entityId = String(url.searchParams.get("entity") || "");
  const route = String(url.searchParams.get("route") || "").slice(0, 200);
  const lang = url.searchParams.get("lang") === "es" ? "es" : "en";
  if (!entityId) return json({ error: "entity required" }, 400);

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return json({ error: "auth" }, 401);

  const [scope, mem] = await Promise.all([resolveEntityScope(entityId), getMyMembershipContext()]);
  if (!scope) return json({ error: "unknown entity" }, 404);
  if (!new Set((mem.memberships || []).map((m) => m.entity_id)).has(scope.entity.id)) return json({ error: "not a member" }, 403);

  const chips = await predictChips(sb, { entityId: scope.entity.id, tz: scope.entity.timezone || "Europe/Madrid", lang, uid, route });

  let impression_id: string | null = null;
  try {
    const { data } = await sb.from("chef_chip_log").insert({
      user_id: uid, entity_id: scope.entity.id, route: route || null, shown: chips.map((c) => c.key),
    }).select("id").maybeSingle();
    impression_id = (data as any)?.id || null;
  } catch {}

  return json({ chips, impression_id });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const impression = String(body?.impression_id || "");
  const tapped = String(body?.tapped || "").slice(0, 40);
  if (!impression || !tapped) return json({ error: "impression_id and tapped required" }, 400);

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return json({ error: "auth" }, 401);

  const { error } = await sb.from("chef_chip_log").update({ tapped, tapped_at: new Date().toISOString() }).eq("id", impression).eq("user_id", uid);
  if (error) return json({ error: error.message }, 400);
  return json({ ok: true });
}
