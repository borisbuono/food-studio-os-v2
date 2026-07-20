import { NextRequest, NextResponse } from "next/server";
import { ingestForMailbox, type AdminMailbox } from "@/lib/files/gmail-ingest";
import { classifyFile } from "@/lib/files/classifier";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_MAILBOXES: AdminMailbox[] = [
  "admin@bistro-mondo.com",
  "admin@ibzfoodstudio.com",
];

// POST /api/files/inbox/ingest
// Body: { mailbox: "admin@bistro-mondo.com" | "admin@ibzfoodstudio.com", sinceMinutes?: number, classify?: boolean }
//
// Triggers a one-off ingest sweep for the given mailbox. Classification is
// on by default; pass classify=false to just stage the rows (they'll pick up
// classification on the next cron sweep).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as any));
  const mailbox = String(body?.mailbox || "") as AdminMailbox;
  const sinceMinutes = Number(body?.sinceMinutes || 30);
  const doClassify = body?.classify !== false;

  if (!VALID_MAILBOXES.includes(mailbox)) {
    return NextResponse.json({
      ok: false,
      error: `mailbox must be one of ${VALID_MAILBOXES.join(", ")}`,
    }, { status: 400 });
  }

  const ingest = await ingestForMailbox(mailbox, sinceMinutes);

  const classified: Array<{ id: string; ok: boolean; error?: string; confidence?: number }> = [];
  if (doClassify && ingest.rows_created > 0) {
    for (const id of ingest.created_ids) {
      const r = await classifyFile(id);
      classified.push({
        id,
        ok: r.ok,
        error: r.error,
        confidence: r.result?.confidence,
      });
    }
  }

  return NextResponse.json({ ok: true, ingest, classified });
}
