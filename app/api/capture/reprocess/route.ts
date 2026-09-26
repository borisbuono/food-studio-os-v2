import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { requireManagerOf } from "@/lib/access/requireManager";
import { ingestCapture } from "@/lib/capture/ingest";
import type { EntityCode } from "@/lib/capture/pure";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/capture/reprocess { table, id }
// Re-file one captured document under the CURRENT rules (entity, supplier,
// dates, tax), from what was read off the paper the first time. No second
// read, no upload. Rows already sent to Holded are never touched.
const MIME: Record<string, string> = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
const STRIP = ["extraction_error", "entity_verdict", "vat_category_issues", "filename"];

export async function POST(req: NextRequest) {
  try {
    const sb = supabaseServer() as any;
    const { data: u } = await sb.auth.getUser();
    if (!u?.user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    const b = await req.json().catch(() => ({}));
    const table = b?.table === "albarans" ? "albarans" : "invoice_inbox";
    const id = String(b?.id || "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
    const cols = table === "invoice_inbox" ? "id, entity_id, storage_path, file_sha256, ocr_extracted, holded_doc_id, source" : "id, entity_id, storage_path, file_sha256, ocr_extracted";
    const { data: row } = await sb.from(table).select(cols).eq("id", id).maybeSingle();
    if (!row) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    if (row.holded_doc_id) return NextResponse.json({ ok: false, error: "already in Holded — not re-filed" }, { status: 409 });
    if (!row.ocr_extracted || !row.storage_path || !row.file_sha256) return NextResponse.json({ ok: false, error: "not a funnel capture" }, { status: 409 });
    const gate = await requireManagerOf(sb, row.entity_id);
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
    const extracted = { ...row.ocr_extracted };
    const filename = extracted.filename || null;
    for (const k of STRIP) delete extracted[k];
    const res = await ingestCapture({
      sb, uid: u.user.id, buf: new ArrayBuffer(0),
      mediaType: MIME[String(row.storage_path).split(".").pop()!.toLowerCase()] || "application/pdf",
      filename, sessionCode: (["BM", "IFL", "BBH", "UTOPIA"].includes(row.entity_id) ? row.entity_id : "BM") as EntityCode,
      source: row.source === "manual_upload" ? "manual_upload" : "paper_photo",
      reuse: { extracted, storagePath: row.storage_path, sha: row.file_sha256, replace: { table, id } },
    });
    return NextResponse.json(res, { status: res.ok ? 200 : res.status });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
