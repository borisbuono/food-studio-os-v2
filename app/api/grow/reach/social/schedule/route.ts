import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import type { EntityCode } from "@/lib/integrations/types";
import { bufferAdapter } from "@/lib/integrations/social/buffer";

export const runtime = "nodejs";

// POST /api/grow/reach/social/schedule
//
// Body: {
//   entity: "IFL"|"BM"|"BBH",
//   channels: Array<"instagram"|"facebook"|"tiktok"|"threads">,
//   caption: string,
//   media_urls: string[],
//   scheduled_at: string | null,
//   post_ids: string[]        — the social_posts rows the composer just wrote
// }
//
// Behaviour:
//   · Sends the post via bufferAdapter.schedulePost. Dry-run gated by
//     FS_SOCIAL_LIVE (same posture as the campaign send route). In dry-run the
//     buffer_update_id is stamped `dry-buffer-<ts>` so the calendar can still
//     surface the linkage.
//   · Updates the social_posts rows with buffer_update_id + status=scheduled
//     (or status=failed with the error message).

const ALLOWED = new Set(["instagram", "facebook", "tiktok", "threads"]);

export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const entity = b.entity as EntityCode;
    if (!["IFL", "BM", "BBH"].includes(entity)) {
      return NextResponse.json({ ok: false, error: "entity must be IFL / BM / BBH" }, { status: 400 });
    }
    const channels: string[] = Array.isArray(b.channels) ? b.channels : [];
    if (!channels.length || channels.some((c) => !ALLOWED.has(c))) {
      return NextResponse.json({ ok: false, error: "channels invalid — instagram|facebook|tiktok|threads" }, { status: 400 });
    }
    const caption = String(b.caption || "").trim();
    if (!caption) return NextResponse.json({ ok: false, error: "caption required" }, { status: 400 });
    const media_urls: string[] = Array.isArray(b.media_urls) ? b.media_urls : [];
    const scheduled_at = b.scheduled_at ? String(b.scheduled_at) : undefined;
    const post_ids: string[] = Array.isArray(b.post_ids) ? b.post_ids : [];

    const live = String(process.env.FS_SOCIAL_LIVE || "").toLowerCase() === "true";
    let result: { external_id: string; dryRun: boolean };
    try {
      result = await bufferAdapter.schedulePost({
        channels: channels as any,
        caption,
        media_urls,
        scheduled_at,
        // @ts-expect-error entity + dryRun are buffer-adapter extensions
        entity,
        dryRun: !live,
      });
    } catch (err: any) {
      // Mark posts failed and surface the error.
      if (post_ids.length) {
        const sb = supabaseServer();
        await sb.from("social_posts")
          .update({ status: "failed", buffer_update_id: null })
          .in("id", post_ids);
      }
      return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 502 });
    }

    if (post_ids.length) {
      const sb = supabaseServer();
      await sb.from("social_posts")
        .update({
          status: "scheduled",
          buffer_update_id: result.external_id || null,
        })
        .in("id", post_ids);
    }
    return NextResponse.json({
      ok: true,
      buffer_update_id: result.external_id,
      dry_run: result.dryRun,
      live,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 400 });
  }
}
