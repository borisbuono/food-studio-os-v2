import { supabaseServer } from "@/lib/supabaseServer";
import { supabaseService } from "@/lib/supabaseService";
import { fillProvisional } from "@/lib/menu/provisional";import { requireEntityAccess } from "@/lib/access/requireManager";


export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/menu/recost  body { entity_id }
//   "Recost now" on the Margin tab. Refreshes purchase prices from the venue's
//   invoice lines, costs every recipe bound to the current menu, fills any
//   still-unpriced ingredient with a PROVISIONAL (flagged) price, costs again.
//   Session-scoped: the caller must be a member of the venue (RLS on the
//   price table; the costing RPCs are granted to authenticated).

function isUuid(x: any): x is string {
  return typeof x === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const entity_id = body?.entity_id;
  if (!isUuid(entity_id)) return Response.json({ ok: false, error: "entity_id required" }, { status: 400 });
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return Response.json({ ok: false, error: "not authenticated" }, { status: 401 });
  // S4: membership proven in the DB before fillProvisional() reads every line on the service key.
  const gate = await requireEntityAccess(sb, entity_id);
  if (!gate.ok) return Response.json({ ok: false, error: gate.error }, { status: gate.status });

  const first = await sb.rpc("fn_recost_entity", { p_entity: entity_id, p_scope: "menu" });
  if (first.error) return Response.json({ ok: false, error: first.error.message }, { status: 500 });

  // provisional fill needs to read every line (service) — the result is flagged, never silent
  const svc = supabaseService();
  const prov = svc ? await fillProvisional(svc, entity_id) : { asked: 0, written: 0, error: "no service key" };
  let second: any = null;
  if (prov.written > 0) {
    const r = await sb.rpc("fn_recost_entity", { p_entity: entity_id, p_scope: "menu" });
    second = r.data ?? null;
  }
  return Response.json({ ok: true, run: second ?? first.data, provisional: prov });
}
