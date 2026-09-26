import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { requireManagerOf } from "@/lib/access/requireManager";
import { pushToHolded } from "@/lib/capture/holded";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/capture/push  { id, mode: "preflight" | "create" | "attach_existing", holded_id?, contact_id?, contact_new? }
// ONE document per call — there is deliberately no batch form of this route.
export async function POST(req: NextRequest) {
  try {
    const sb = supabaseServer();
    const body = await req.json().catch(() => ({}));
    const id = String(body?.id || "");
    const mode = String(body?.mode || "preflight") as "preflight" | "create" | "attach_existing";
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
    if (!["preflight", "create", "attach_existing"].includes(mode)) return NextResponse.json({ ok: false, error: "bad mode" }, { status: 400 });
    const { data: row } = await sb.from("invoice_inbox").select("entity_id").eq("id", id).maybeSingle();
    if (!row) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    const gate = await requireManagerOf(sb as any, (row as any).entity_id);
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
    const res = await pushToHolded(sb as any, gate.uid, id, mode, body?.holded_id ? String(body.holded_id) : undefined,
      { contact_id: body?.contact_id ? String(body.contact_id) : undefined, contact_new: body?.contact_new === true });
    return NextResponse.json(res, { status: res.ok ? 200 : res.status });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
