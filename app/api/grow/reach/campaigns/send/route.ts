import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import type { EntityCode } from "@/lib/integrations/types";
import { bufferAdapter } from "@/lib/integrations/social/buffer";

export const runtime = "nodejs";

// POST /api/grow/reach/campaigns/send
//
// Body: {
//   entity: "IFL" | "BM" | "BBH",
//   restaurant_id: string,
//   segment: string,
//   segment_size: number,
//   commercial_id: string | null,
//   subject: string | null,
//   body: string,
//   channels: { email?: { addresses: string[] } | null; social?: { channels: string[] } | null },
//   scheduled_at: string | null,
// }
//
// Behaviour:
//  · Writes a row to `campaign_dispatch_log` (audit) — dry-run by default via env
//    FS_GROW_CAMPAIGN_LIVE. Same posture as EOD adapter posts.
//  · Dispatches social via bufferAdapter.schedulePost when live; email delegates
//    to the existing Wix Newsletter surface (not exercised here — the campaign
//    composer + Wix schedule flow ships in the follow-up sprint).
export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const entity = b.entity as EntityCode;
    if (!["IFL", "BM", "BBH"].includes(entity)) {
      return NextResponse.json({ ok: false, error: "entity must be IFL / BM / BBH" }, { status: 400 });
    }
    const rid = String(b.restaurant_id || "").trim();
    if (!rid) return NextResponse.json({ ok: false, error: "restaurant_id required" }, { status: 400 });
    const body = String(b.body || "").trim();
    if (!body) return NextResponse.json({ ok: false, error: "body required" }, { status: 400 });

    const live = (process.env.FS_GROW_CAMPAIGN_LIVE || "").toLowerCase() === "true";
    const emailAddresses: string[] = Array.isArray(b.channels?.email?.addresses) ? b.channels.email.addresses : [];
    const socialChannels: string[] = Array.isArray(b.channels?.social?.channels) ? b.channels.social.channels : [];

    let social_posts = 0;
    let external_ids: string[] = [];

    if (socialChannels.length > 0) {
      try {
        const r = await bufferAdapter.schedulePost({
          channels: socialChannels as any,
          caption: body,
          media_urls: [],
          scheduled_at: b.scheduled_at || undefined,
          // Non-standard fields the adapter reads for entity + dry-run gating.
          // These are ignored by the SocialAdapter contract but honoured by the
          // buffer implementation.
          // @ts-expect-error entity + dryRun are buffer-adapter extensions
          entity,
          dryRun: !live,
        });
        social_posts = 1;
        if (r.external_id) external_ids.push(r.external_id);
      } catch (e: any) {
        // Non-fatal — record the failure in the log so Boris sees it.
        return NextResponse.json({ ok: false, error: "Buffer: " + (e?.message || String(e)) }, { status: 502 });
      }
    }

    // Email side: not wired live here — the composer records the intent, actual
    // send routing waits for the Wix campaign create endpoint. Still logged so
    // the audit trail shows what was intended.
    const email_reach = emailAddresses.length;

    // Audit — best-effort insert. If the table doesn't exist yet (schema not
    // migrated), we still return ok with the dry-run result.
    const sb = supabaseServer();
    try {
      const { data: uRes } = await sb.auth.getUser();
      await sb.from("campaign_dispatch_log").insert({
        restaurant_id: rid,
        entity_code: entity,
        segment: String(b.segment || ""),
        segment_size: Number(b.segment_size || 0),
        commercial_id: b.commercial_id || null,
        subject: b.subject || null,
        body,
        channels: { email: b.channels?.email || null, social: b.channels?.social || null },
        scheduled_at: b.scheduled_at || null,
        dry_run: !live,
        external_ids,
        email_reach,
        social_posts,
        created_by: uRes.user?.id || null,
      });
    } catch { /* audit best-effort */ }

    return NextResponse.json({
      ok: true,
      dryRun: !live,
      email_reach,
      social_posts,
      external_ids,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
