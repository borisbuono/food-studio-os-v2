import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { requireManagerOf } from "@/lib/access/requireManager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/email/accounts { action: "disconnect", id }       revoke + delete the Vault secrets
//                          { action: "set", id, forwards_to_holded?: boolean, display_name?: string }
// Both through the signed-in manager's RLS client; the disconnect RPC checks
// app_my_managed_entities() itself before touching Vault.
export async function POST(req: NextRequest) {
  const sb = supabaseServer();
  let p: any;
  try { p = await req.json(); } catch { return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 }); }
  const id = String(p.id || "");
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  const { data: row } = await sb.from("email_accounts").select("id, entity_id").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const gate = await requireManagerOf(sb, (row as any).entity_id);
  if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });

  if (p.action === "disconnect") {
    const { error } = await sb.rpc("email_account_disconnect", { p_account_id: id });
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 403 });
    return NextResponse.json({ ok: true });
  }
  if (p.action === "set") {
    const patch: Record<string, unknown> = {};
    if (typeof p.forwards_to_holded === "boolean") patch.forwards_to_holded = p.forwards_to_holded;
    if (typeof p.display_name === "string") patch.display_name = p.display_name.slice(0, 120) || null;
    if (!Object.keys(patch).length) return NextResponse.json({ ok: false, error: "nothing to set" }, { status: 400 });
    const { error } = await sb.from("email_accounts").update(patch).eq("id", id);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 403 });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
}
