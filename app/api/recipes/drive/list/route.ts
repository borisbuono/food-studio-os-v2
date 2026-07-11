// POST /api/recipes/drive/list
// Lists files in a Google Drive folder. STUB — returns a sample manifest
// derived from Boris's recipe folder structure until real OAuth ships.
// The Drive folder id is 1J3A704Hmmk9Ny9ePu6Z2ltMis18whtvT (per memory
// recipe_master_corpus.md); the real client will be added in a follow-up
// patch once the OAuth consent screen is registered.

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORPUS_FOLDER_ID = "1J3A704Hmmk9Ny9ePu6Z2ltMis18whtvT";

// The stub returns a deterministic sample so the UI can render a plausible
// list. Real folder contents flow once the Drive client is wired.
const SAMPLE_FILES = [
  { id: "sample-01", name: "Bikini de foie · IFS.pdf", mimeType: "application/pdf", modifiedTime: "2026-05-14T10:22:00Z", sizeBytes: 214300 },
  { id: "sample-02", name: "Sobrasada tostada.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", modifiedTime: "2026-04-30T09:11:00Z", sizeBytes: 41200 },
  { id: "sample-03", name: "Bullit de peix — receta madre.md", mimeType: "text/markdown", modifiedTime: "2026-06-02T18:44:00Z", sizeBytes: 3800 },
  { id: "sample-04", name: "Salsa romesco (batch 4kg).txt", mimeType: "text/plain", modifiedTime: "2026-05-22T14:00:00Z", sizeBytes: 1900 },
];

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const folderId: string = body.folder_id || CORPUS_FOLDER_ID;

  const connected = !!process.env.GOOGLE_DRIVE_ACCESS_TOKEN;

  if (!connected) {
    return NextResponse.json({
      folder_id: folderId,
      connected: false,
      stub: true,
      message: "Drive OAuth not yet connected — returning sample manifest so the UI is testable end-to-end.",
      files: SAMPLE_FILES,
    });
  }

  // Real path (guarded so the shape is fixed even before we wire it):
  try {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents&fields=files(id,name,mimeType,modifiedTime,size)&pageSize=200`,
      { headers: { Authorization: `Bearer ${process.env.GOOGLE_DRIVE_ACCESS_TOKEN}` } }
    );
    const j: any = await res.json();
    return NextResponse.json({
      folder_id: folderId,
      connected: true,
      stub: false,
      files: (j.files || []).map((f: any) => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        modifiedTime: f.modifiedTime,
        sizeBytes: f.size ? Number(f.size) : null,
      })),
    });
  } catch (e) {
    return NextResponse.json({ folder_id: folderId, connected: false, error: (e as Error).message, files: [] });
  }
}
