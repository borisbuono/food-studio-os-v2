import { supabaseServer } from "@/lib/supabaseServer";
import { serverEntity } from "@/lib/serverVenue";
import { googleBusinessAdapter } from "@/lib/integrations/reviews/google-business";
import { tripAdvisorAdapter } from "@/lib/integrations/reviews/tripadvisor";
import { theForkReviewsAdapter } from "@/lib/integrations/reviews/thefork";
import type { ReviewsAdapter, EntityCode } from "@/lib/integrations/types";

export const runtime = "nodejs";

function entityKeyToCode(key: string): EntityCode {
  if (key === "taller") return "IFL";
  if (key === "bistro_mondo") return "BM";
  if (key === "holdings") return "BBH";
  return "IFL";
}

const ADAPTERS: Record<string, ReviewsAdapter> = {
  google_business: googleBusinessAdapter,
  tripadvisor: tripAdvisorAdapter,
  thefork: theForkReviewsAdapter,
};

// POST /api/grow/reputation/reply — { review_id, body }
// Loads the review, dispatches to the platform's postReply, writes response_body
// back on success (audit trail: response_by = current user).
export async function POST(req: Request) {
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user?.id) return Response.json({ ok: false, error: "sign in to reply" }, { status: 401 });

  const body = await req.json().catch(() => ({} as any));
  const review_id = String(body?.review_id || "");
  const text = String(body?.body || "").trim();
  if (!review_id || !text) return Response.json({ ok: false, error: "review_id + body required" }, { status: 400 });
  if (text.length > 4000) return Response.json({ ok: false, error: "reply too long (>4000 chars)" }, { status: 400 });

  const { data: review, error } = await sb.from("reviews")
    .select("id,restaurant_id,platform,external_id")
    .eq("id", review_id)
    .maybeSingle();
  if (error || !review) return Response.json({ ok: false, error: "review not found" }, { status: 404 });

  const adapter = ADAPTERS[review.platform];
  if (!adapter) return Response.json({ ok: false, error: `no adapter for ${review.platform}` }, { status: 400 });

  const entityCode = entityKeyToCode(serverEntity());
  const result = await adapter.postReply(entityCode, review.external_id, text);
  if (!result.ok) return Response.json({ ok: false, error: "platform postReply failed" }, { status: 502 });

  const nowISO = new Date().toISOString();
  await sb.from("reviews")
    .update({ response_body: text, response_posted_at: nowISO, response_by: u.user.id })
    .eq("id", review_id);

  // Refresh unreplied counter on the status tile (best-effort)
  const { count } = await sb.from("reviews")
    .select("id", { count: "exact", head: true })
    .eq("restaurant_id", review.restaurant_id)
    .eq("platform", review.platform)
    .is("response_body", null);
  await sb.from("reviews_platform_status")
    .update({ unreplied_count: count || 0 })
    .eq("restaurant_id", review.restaurant_id)
    .eq("platform", review.platform);

  // Audit
  await sb.from("chef_actions").insert({
    user_id: u.user.id,
    action_type: "reputation.reply",
    target_table: "reviews",
    target_id: review_id,
    payload: { platform: review.platform, dryRun: result.dryRun },
    reversible: false,
  });

  return Response.json({ ok: true, dryRun: result.dryRun });
}
