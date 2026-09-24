import { NextRequest, NextResponse } from "next/server";
import { supabaseJob } from "@/lib/supabaseJob";
import { materialiseNotes } from "@/lib/chef/paInbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/cron/pa-inbox — sweep pending pa_inbox_notes into the `pa_inbox`
// Storage bucket (see lib/chef/paInbox.ts). Same auth convention as the
// other cron targets: `Authorization: Bearer $CRON_SECRET`; skipped in dev
// when no secret is set.
//
// NOT in vercel.json: the Hobby plan's cron slots are taken (finance
// nightly-scan, pos-nightly). /api/chef/act materialises each note right
// after queueing it, so this route is the backstop — run it by hand
// (curl -H "Authorization: Bearer $CRON_SECRET" https://www.foodstudio.ai/api/cron/pa-inbox)
// or wire it from pg_cron + pg_net like social-inbox-pull when a slot frees.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization") || "";
    if (auth !== "Bearer " + secret) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const sb = supabaseJob();
  const r = await materialiseNotes(sb, { limit: 100 });
  // What the PA session still has to pull down.
  const { data: unsynced } = await sb.from("pa_inbox_notes").select("filename, storage_path, materialised_at").eq("status", "written").is("synced_at", null).order("created_at").limit(100);
  return NextResponse.json({ ok: r.failed === 0, ...r, unsynced: unsynced || [] });
}
