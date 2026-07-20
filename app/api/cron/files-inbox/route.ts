import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { ingestForMailbox, type AdminMailbox } from "@/lib/files/gmail-ingest";
import { classifyFile } from "@/lib/files/classifier";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/cron/files-inbox
//
// Vercel cron target. Every 15 min sweep both admin@ mailboxes, ingest new
// attachments, classify each new row with Anthropic vision. Read-only against
// Gmail. Every step logs to assistant_actions so ops can trace what landed.
//
// Vercel cron sends `Authorization: Bearer $CRON_SECRET`. In dev (no
// secret set) we skip the check so `curl` works — same convention as the
// finance/nightly-scan endpoint.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization") || "";
    if (auth !== "Bearer " + secret) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }

  // A 15-min cron with a 20-min ingest window gives 5 min of overlap so a
  // sweep that runs a few seconds late doesn't miss anything.
  const SINCE_MINUTES = 20;
  const mailboxes: AdminMailbox[] = [
    "admin@bistro-mondo.com",
    "admin@ibzfoodstudio.com",
  ];

  const results: any[] = [];
  for (const mailbox of mailboxes) {
    const ingest = await ingestForMailbox(mailbox, SINCE_MINUTES);
    const classified: Array<{ id: string; ok: boolean; confidence?: number }> = [];
    for (const id of ingest.created_ids) {
      const r = await classifyFile(id);
      classified.push({ id, ok: r.ok, confidence: r.result?.confidence });
    }
    results.push({ mailbox, ingest, classified_count: classified.length });
  }

  // Sweep any lingering pending_classify rows too — happens if a previous
  // sweep ingested but the classifier throw before it could run.
  const sb = supabaseServer();
  const { data: stragglers } = await sb.from("files_inbox")
    .select("id")
    .eq("status", "pending_classify")
    .limit(20);
  const straggler_count = (stragglers || []).length;
  for (const s of (stragglers || [])) {
    await classifyFile(s.id);
  }

  await sb.from("assistant_actions").insert({
    user_id: null,
    action_kind: "files_inbox_cron",
    action_type: "files.inbox.cron_sweep",
    entity_code: null,
    payload: {
      at: new Date().toISOString(),
      results,
      stragglers_classified: straggler_count,
    },
    reversible: false,
  });

  return NextResponse.json({
    ok: true,
    at: new Date().toISOString(),
    results,
    stragglers_classified: straggler_count,
  });
}
