import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { inboxCategoryToLibraryCategory, type InboxCategory } from "@/lib/files/classifier";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIBRARY_CATEGORIES = new Set([
  "haccp","contract","brand","gestoria","statement",
  "legal","insurance","certification","menu_pdf","other",
]);

// POST /api/files/inbox/[id]/approve
// Body: { entity?: "IFL"|"BM"|"BBH", category?: string, title?: string,
//         description?: string, valid_until?: string|null, tags?: string[] }
//
// User confirms an inbox row — copies the storage object to the library
// bucket, creates a files_documents row, and marks the inbox row filed.
// Any fields not passed in the body fall back to the suggested_* values on
// the row.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const sb = supabaseServer();
  const body = await req.json().catch(() => ({} as any));

  const { data: row, error: readErr } = await sb.from("files_inbox")
    .select("*")
    .eq("id", params.id)
    .maybeSingle();
  if (readErr) return NextResponse.json({ ok: false, error: readErr.message }, { status: 500 });
  if (!row) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  if (row.status === "filed") {
    return NextResponse.json({ ok: false, error: "already filed", filed_document_id: row.filed_document_id }, { status: 409 });
  }
  if (row.status === "rejected") {
    return NextResponse.json({ ok: false, error: "row was rejected — cannot approve" }, { status: 409 });
  }

  // ---- Resolve final field values ---------------------------------------
  const entity: "IFL" | "BM" | "BBH" | null =
    (body?.entity && ["IFL","BM","BBH"].includes(body.entity)) ? body.entity :
    row.suggested_entity || null;
  if (!entity) {
    return NextResponse.json({ ok: false, error: "entity is required — pick IFL / BM / BBH" }, { status: 400 });
  }

  // Library category: either an override sent from the UI, or derive from
  // the suggested_category via inboxCategoryToLibraryCategory.
  let libraryCategory: string;
  if (typeof body?.category === "string" && body.category.trim()) {
    const c = body.category.trim().toLowerCase();
    if (!LIBRARY_CATEGORIES.has(c)) {
      return NextResponse.json({ ok: false, error: `unknown category '${c}'` }, { status: 400 });
    }
    libraryCategory = c;
  } else {
    libraryCategory = inboxCategoryToLibraryCategory(
      row.suggested_category as InboxCategory | null,
    );
  }

  const title = String(body?.title || row.suggested_title || "Untitled").trim().slice(0, 200);
  const description = typeof body?.description === "string" ? body.description.trim() : null;
  const validUntil = body?.valid_until === null
    ? null
    : (typeof body?.valid_until === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.valid_until)
        ? body.valid_until
        : row.suggested_valid_until || null);
  const tags: string[] = Array.isArray(body?.tags)
    ? body.tags.map((t: any) => String(t).trim()).filter(Boolean).slice(0, 32)
    : [];

  // ---- Copy the storage object from inbox → library ---------------------
  const inboxPath = String(row.file_url || "");
  const inboxKey = inboxPath.startsWith("documents-inbox/") ? inboxPath.slice("documents-inbox/".length) : inboxPath;
  const filename = inboxKey.split("/").pop() || "file";
  // Preserve extension; drop the leading `<uuid>_` prefix if present.
  const bare = filename.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_/, "");
  const day = new Date().toISOString().slice(0, 10);
  const libraryKey = `${entity}/${libraryCategory}/${day}_${bare}`;
  const libraryPath = libraryKey; // files_documents stores path *without* bucket prefix

  const { data: dl, error: dlErr } = await sb.storage.from("documents-inbox").download(inboxKey);
  if (dlErr || !dl) {
    return NextResponse.json({ ok: false, error: "could not read inbox object: " + (dlErr?.message || "missing") }, { status: 500 });
  }
  const buf = new Uint8Array(await dl.arrayBuffer());
  const { error: upErr } = await sb.storage.from("documents").upload(libraryPath, buf, {
    contentType: row.mime_type || "application/octet-stream",
    upsert: true,
  });
  if (upErr) {
    return NextResponse.json({ ok: false, error: "library upload failed: " + upErr.message }, { status: 500 });
  }

  // ---- Insert files_documents -------------------------------------------
  const { data: userData } = await sb.auth.getUser();
  const uid = userData?.user?.id || null;
  const { data: inserted, error: insErr } = await sb.from("files_documents").insert({
    entity_code: entity,
    category: libraryCategory,
    title,
    description,
    file_url: libraryPath,
    file_bytes: row.file_bytes,
    mime_type: row.mime_type,
    tags,
    uploaded_by: uid,
    valid_until: validUntil,
  }).select("id").maybeSingle();
  if (insErr || !inserted) {
    return NextResponse.json({ ok: false, error: "library row insert failed: " + (insErr?.message || "unknown") }, { status: 500 });
  }

  // ---- Mark inbox row filed ---------------------------------------------
  await sb.from("files_inbox").update({
    status: "filed",
    filed_document_id: inserted.id,
    triaged_at: new Date().toISOString(),
    triaged_by: uid,
    // Persist the operator's overrides so the audit trail matches reality.
    suggested_entity: entity,
    suggested_title: title,
    suggested_valid_until: validUntil,
  }).eq("id", params.id);

  // ---- Audit -------------------------------------------------------------
  await sb.from("assistant_actions").insert({
    user_id: uid,
    action_kind: "files_inbox_approve",
    action_type: "files.inbox.approve",
    entity_code: entity,
    target_table: "files_documents",
    target_id: inserted.id,
    payload: {
      inbox_id: params.id,
      library_id: inserted.id,
      category: libraryCategory,
      title,
      valid_until: validUntil,
      overrides: {
        entity: body?.entity ?? null,
        category: body?.category ?? null,
        title: body?.title ?? null,
        valid_until: body?.valid_until ?? null,
      },
    },
    reversible: true,
  });

  return NextResponse.json({ ok: true, filed_document_id: inserted.id });
}
