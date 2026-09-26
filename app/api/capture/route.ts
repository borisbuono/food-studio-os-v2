import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { serverEntity } from "@/lib/serverVenue";
import { E_BM, E_HOLDINGS, E_TALLER, E_UTOPIA } from "@/lib/entities";
import { ingestCapture } from "@/lib/capture/ingest";
import type { EntityCode } from "@/lib/capture/pure";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST /api/capture — the document funnel's front door (scanner, upload, photo).
// multipart: file (PDF or image), optional filename.
// The entity is read off the paper; the session venue is only the fallback,
// and a fallback is always flagged `entity_guessed` + needs_triage.
// Chef's camera uses /api/capture/rich and is not touched by this route.

const SESSION_CODE: Record<string, EntityCode> = { [E_BM]: "BM", [E_TALLER]: "IFL", [E_HOLDINGS]: "BBH", [E_UTOPIA]: "UTOPIA" };
const ACCEPT = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

export async function POST(req: NextRequest) {
  try {
    const sb = supabaseServer();
    const { data: u } = await sb.auth.getUser();
    if (!u?.user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof Blob)) return NextResponse.json({ ok: false, error: "no file" }, { status: 400 });
    const mediaType = (file as any).type || "application/octet-stream";
    if (!ACCEPT.has(mediaType)) return NextResponse.json({ ok: false, error: `unsupported file type ${mediaType} — PDF, JPEG, PNG or WebP` }, { status: 415 });
    if (file.size > 30 * 1024 * 1024) return NextResponse.json({ ok: false, error: "file over 30 MB" }, { status: 413 });
    const filename = String(form.get("filename") || (file as any).name || "") || null;
    const res = await ingestCapture({
      sb: sb as any,
      uid: u.user.id,
      buf: await file.arrayBuffer(),
      mediaType,
      filename,
      sessionCode: SESSION_CODE[serverEntity()] || "BM",
      source: String(form.get("source") || "") === "manual_upload" ? "manual_upload" : "paper_photo",
    });
    if (!res.ok) return NextResponse.json(res, { status: res.status });
    return NextResponse.json({ ...res, next: "/administrate/finance/scans?id=" + res.id });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
