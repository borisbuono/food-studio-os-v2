import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { serverEntity } from "@/lib/serverVenue";
import { EntityKey } from "@/lib/entities";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ENTITY_CODE: Record<EntityKey, string> = {
  holdings: "BBH",
  bistro_mondo: "BM",
  taller: "IFL",
  utopia: "IFL",
};

// GET /api/files/inbox — list inbox rows for the current entity.
// Query: ?status=needs_triage|pending_classify|filed|rejected (comma-separated ok)
//        ?limit=50 (default 100, max 250)
export async function GET(req: NextRequest) {
  const sb = supabaseServer();
  const url = new URL(req.url);
  const entityParam = url.searchParams.get("entity");
  const ec = entityParam && ["IFL", "BM", "BBH"].includes(entityParam)
    ? entityParam
    : ENTITY_CODE[serverEntity()];
  const statusParam = url.searchParams.get("status") || "";
  const statuses = statusParam
    ? statusParam.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  const limit = Math.min(250, Math.max(1, Number(url.searchParams.get("limit") || 100)));

  // Match rows where suggested_entity IS null (unclassified — visible to
  // every operator to help triage) OR equals the current entity.
  let q = sb.from("files_inbox")
    .select("id,source,source_ref,sender,subject,received_at,file_url,file_bytes,mime_type,thumbnail_url,suggested_category,suggested_entity,suggested_title,suggested_valid_until,classification_confidence,classification_rationale,status,filed_document_id,created_at,triaged_at,triaged_by")
    .or(`suggested_entity.eq.${ec},suggested_entity.is.null`)
    .order("received_at", { ascending: false })
    .limit(limit);
  if (statuses.length) q = q.in("status", statuses);

  const { data, error } = await q;
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, entity: ec, rows: data || [] });
}
