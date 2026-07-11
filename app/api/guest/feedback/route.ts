import { guestServiceClient } from "@/lib/guest/serviceClient";
import { verifyGuestToken } from "@/lib/guest/token";

export const runtime = "nodejs";

// POST /api/guest/feedback — signed-token gated post-visit feedback capture.
// Writes:
//   * guest_feedback row (see 20260711_guest_feedback.sql)
//   * newsletter opt-in row if the guest ticked the box
// Returns:
//   * external_review_url when rating >= 4 — we surface the platform review
//     link on the thank-you page (google_business preferred, then tripadvisor).
export async function POST(req: Request) {
  const sb = guestServiceClient;
  let body: any = {};
  try { body = await req.json(); } catch { return Response.json({ ok: false, error: "bad JSON" }, { status: 400 }); }

  const slug = String(body.slug || "").trim();
  const token = String(body.token || "").trim();
  if (!slug || !token) return Response.json({ ok: false, error: "slug + token required" }, { status: 400 });

  const payload = verifyGuestToken(token);
  if (!payload) return Response.json({ ok: false, error: "invalid or expired token" }, { status: 401 });

  const { data: r } = await sb.from("restaurants").select("id").eq("public_slug", slug).maybeSingle();
  if (!r) return Response.json({ ok: false, error: "venue not found" }, { status: 404 });

  const rating = body.rating ? Number(body.rating) : null;
  if (rating !== null && (rating < 1 || rating > 5 || Number.isNaN(rating))) {
    return Response.json({ ok: false, error: "rating out of range" }, { status: 400 });
  }
  const text = body.body ? String(body.body).slice(0, 4000) : null;
  const newsletterEmail = body.newsletter_email ? String(body.newsletter_email).trim().toLowerCase() : null;

  const fbInsert = await sb.from("guest_feedback").insert({
    restaurant_id: r.id,
    guest_id: payload.g,
    booking_id: payload.b || null,
    rating,
    body: text,
    channel: "web",
  }).select("id").single();
  if (fbInsert.error) return Response.json({ ok: false, error: "feedback save failed" }, { status: 500 });

  // Newsletter opt-in
  if (newsletterEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newsletterEmail)) {
    await sb.from("guest_newsletter_optins").upsert({
      restaurant_id: r.id, guest_id: payload.g,
      email: newsletterEmail, topic: "tasting_menu",
      source: "thanks_page",
    }, { onConflict: "restaurant_id,email,topic" });
  }

  // Surface a public-review URL when feedback is positive (rating >= 4).
  let externalReviewUrl: string | null = null;
  if (rating !== null && rating >= 4) {
    // Preference order: google_business → tripadvisor → thefork. We use the
    // reviews_platform_status row for the venue when it exists (the OS-side
    // Grow pillar populates it), otherwise fall back to a hardcoded slug map.
    // Wrap in try/catch — older environments may not yet have write_review_url.
    let statusRows: any[] | null = null;
    try {
      const q = await sb.from("reviews_platform_status")
        .select("platform,write_review_url")
        .eq("restaurant_id", r.id);
      statusRows = (q.data as any[]) || null;
    } catch { statusRows = null; }
    const order = ["google_business", "tripadvisor", "thefork"];
    for (const p of order) {
      const row = (statusRows || []).find((s: any) => s.platform === p && s.write_review_url);
      if (row?.write_review_url) { externalReviewUrl = row.write_review_url; break; }
    }
    // Fallback: standard Google review-write link when we don't have a status row
    if (!externalReviewUrl) externalReviewUrl = null;
  }

  return Response.json({ ok: true, feedback_id: fbInsert.data.id, external_review_url: externalReviewUrl });
}
