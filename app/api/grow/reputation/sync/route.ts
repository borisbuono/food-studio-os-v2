import { supabaseServer } from "@/lib/supabaseServer";
import { serverRestaurantId, serverEntity } from "@/lib/serverVenue";
import { getReviewsAdapter } from "@/lib/integrations/registry";
import { googleBusinessAdapter } from "@/lib/integrations/reviews/google-business";
import { tripAdvisorAdapter } from "@/lib/integrations/reviews/tripadvisor";
import { theForkReviewsAdapter } from "@/lib/integrations/reviews/thefork";
import type { ReviewsAdapter, EntityCode, ReviewRecord } from "@/lib/integrations/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Map UI entity keys to the EntityCode used by adapters.
function entityKeyToCode(key: string): EntityCode {
  if (key === "taller") return "IFL";
  if (key === "bistro_mondo") return "BM";
  if (key === "holdings") return "BBH";
  return "IFL";
}

// Normalise ReviewRecord.platform ("google" | "tripadvisor" | "thefork" | "yelp")
// to the DB enum values ("google_business" | ...).
function platformToDb(p: string): string {
  if (p === "google") return "google_business";
  return p; // tripadvisor / thefork / yelp match
}

const ADAPTERS: Record<string, ReviewsAdapter> = {
  google_business: googleBusinessAdapter,
  tripadvisor: tripAdvisorAdapter,
  thefork: theForkReviewsAdapter,
};

// POST /api/grow/reputation/sync — pulls all connected platforms for the
// current venue, upserts reviews, refreshes reviews_platform_status counters.
// Called by the "Sync all now" button + (later) a cron.
export async function POST(req: Request) {
  const sb = supabaseServer();
  const rid = serverRestaurantId();
  const entityCode = entityKeyToCode(serverEntity());

  // Optional body: { since_days?: number, platforms?: string[] }
  const body = await req.json().catch(() => ({} as any));
  const sinceDays = typeof body?.since_days === "number" ? body.since_days : 365;
  const since = Math.floor(Date.now() / 1000) - sinceDays * 86400;
  const wantPlatforms: string[] = Array.isArray(body?.platforms) && body.platforms.length
    ? body.platforms
    : Object.keys(ADAPTERS);

  const results: Record<string, { pulled: number; upserted: number; error?: string }> = {};

  for (const platform of wantPlatforms) {
    const adapter = ADAPTERS[platform];
    if (!adapter) { results[platform] = { pulled: 0, upserted: 0, error: "unknown platform" }; continue; }

    let pulled: ReviewRecord[] = [];
    try {
      pulled = await adapter.listReviewsSince(entityCode, since);
    } catch (e: any) {
      results[platform] = { pulled: 0, upserted: 0, error: e?.message || "listReviews failed" };
      await sb.from("reviews_platform_status")
        .upsert({ restaurant_id: rid, platform, last_synced_at: new Date().toISOString(), last_error: (e?.message || "unknown").slice(0, 500) }, { onConflict: "restaurant_id,platform" });
      continue;
    }

    // Upsert reviews. onConflict on (platform, external_id) — DB dedupes rescans.
    let upserted = 0;
    for (const r of pulled) {
      const row = {
        restaurant_id: rid,
        platform: platformToDb(r.platform),
        external_id: r.external_id,
        reviewer_name: r.author_name,
        reviewer_avatar_url: null,
        rating: r.rating,
        title: null,
        body: r.body,
        language: null,
        posted_at: r.posted_at,
        response_body: r.reply?.body || null,
        response_posted_at: r.reply?.posted_at || null,
        url: r.url,
      };
      const { error } = await sb.from("reviews").upsert(row, { onConflict: "platform,external_id" });
      if (!error) upserted++;
    }

    // Refresh status tile — read the up-to-date counts back from the table
    const monthAgoISO = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
    const [{ data: agg }, { count: monthCount }, { count: unrepliedCount }] = await Promise.all([
      sb.from("reviews").select("rating").eq("restaurant_id", rid).eq("platform", platformToDb(platform === "google_business" ? "google" : platform)),
      sb.from("reviews").select("id", { count: "exact", head: true }).eq("restaurant_id", rid).eq("platform", platform).gte("posted_at", monthAgoISO),
      sb.from("reviews").select("id", { count: "exact", head: true }).eq("restaurant_id", rid).eq("platform", platform).is("response_body", null),
    ]);

    const rated = (agg || []).filter((x: any) => typeof x.rating === "number");
    const avg = rated.length ? Math.round((rated.reduce((s: number, x: any) => s + x.rating, 0) / rated.length) * 100) / 100 : null;

    await sb.from("reviews_platform_status").upsert({
      restaurant_id: rid,
      platform,
      avg_rating: avg,
      total_reviews: agg?.length || 0,
      reviews_this_month: monthCount || 0,
      unreplied_count: unrepliedCount || 0,
      last_synced_at: new Date().toISOString(),
      last_error: null,
    }, { onConflict: "restaurant_id,platform" });

    results[platform] = { pulled: pulled.length, upserted };
  }

  return Response.json({ ok: true, restaurant_id: rid, entity: entityCode, results });
}
