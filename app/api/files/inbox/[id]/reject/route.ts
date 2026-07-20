import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/files/inbox/[id]/reject
// Body: { reason?: string }
//
// Marks an inbox row as rejected — kept in the table for audit (spam
// attachments, misc images, wrong entity). Storage object is left intact so
// the row can be re-approved manually if needed.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const sb = supabaseServer();
  const body = await req.json().catch(() => ({} as any));
  const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 400) : null;

  const { data: row } = await sb.from("files_inbox")
    .select("id,status,suggested_entity")
    .eq("id", params.id)
    .maybeSingle();
  if (!row) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  if (row.status === "rejected") return NextResponse.json({ ok: true, already: true });
  if (row.status === "filed") {
    return NextResponse.json({ ok: false, error: "cannot reject a filed row — archive the library entry instead" }, { status: 409 });
  }

  const { data: userData } = await sb.auth.getUser();
  const uid = userData?.user?.id || null;

  await sb.from("files_inbox").update({
    status: "rejected",
    triaged_at: new Date().toISOString(),
    triaged_by: uid,
    classification_rationale: reason
      ? `[rejected] ${reason}`
      : (row as any).classification_rationale || "[rejected]",
  }).eq("id", params.id);

  await sb.from("assistant_actions").insert({
    user_id: uid,
    action_kind: "files_inbox_reject",
    action_type: "files.inbox.reject",
    entity_code: (row as any).suggested_entity || null,
    target_table: "files_inbox",
    target_id: params.id,
    payload: { reason },
    reversible: true,
  });

  return NextResponse.json({ ok: true });
}
