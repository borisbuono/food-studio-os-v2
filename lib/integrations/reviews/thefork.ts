import type { ReviewsAdapter, ReviewRecord, EntityCode } from "@/lib/integrations/types";
import { getEntityCredential } from "@/lib/integrations/credentials";

// TheFork Partner API — restaurant reviews + reply capability.
// AUTH REALITY — Partner API requires enrollment; Partner ID is stored per entity.
// For now we read the API key from entity_integrations and the restaurant id
// from env vars (settings page in commit #3 will let Boris manage both).
//   THEFORK_RESTAURANT_{IFL|BM|BBH}
// Docs: https://partner-api.thefork.com/ (partner-only)

const BASE = "https://partner-api.thefork.com/v1";
const DRY_RUN = process.env.FS_REVIEWS_DRY_RUN !== "false";

const RESTAURANT_ENV: Record<EntityCode, string | undefined> = {
  IFL: process.env.THEFORK_RESTAURANT_IFL,
  BM:  process.env.THEFORK_RESTAURANT_BM,
  BBH: process.env.THEFORK_RESTAURANT_BBH,
};

function mapReview(raw: any): ReviewRecord {
  return {
    external_id: String(raw.id || raw.review_id || ""),
    platform: "thefork",
    author_name: raw.customer?.first_name ? `${raw.customer.first_name} ${(raw.customer.last_name || "").charAt(0)}.` : (raw.author_name || null),
    rating: typeof raw.overall_rating === "number" ? raw.overall_rating : (typeof raw.rating === "number" ? raw.rating : null),
    body: raw.comment || raw.review_text || "",
    posted_at: raw.created_at || raw.review_date || new Date().toISOString(),
    reply: raw.reply || raw.owner_response ? { body: raw.reply?.text || raw.owner_response?.text || "", posted_at: raw.reply?.created_at || raw.owner_response?.created_at || "" } : null,
    url: raw.url || null,
  };
}

export const theForkReviewsAdapter: ReviewsAdapter = {
  name: "TheFork Reviews",
  vendor: "thefork",

  async listReviewsSince(entity: EntityCode, sinceUnixSec: number): Promise<ReviewRecord[]> {
    const key = await getEntityCredential(entity, "thefork");
    const rid = RESTAURANT_ENV[entity];
    if (!key || !rid) return [];
    const url = `${BASE}/restaurants/${rid}/reviews?limit=50`;
    try {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${key}`, accept: "application/json" } });
      if (!r.ok) return [];
      const d = await r.json();
      const items: any[] = d.reviews || d.data || [];
      return items
        .map(mapReview)
        .filter((rev) => new Date(rev.posted_at).getTime() / 1000 >= sinceUnixSec);
    } catch {
      return [];
    }
  },

  async postReply(entity: EntityCode, external_id: string, body: string) {
    if (DRY_RUN) {
      // eslint-disable-next-line no-console
      console.log("[thefork:dry-run] would POST reply", { entity, external_id, body });
      return { ok: true, dryRun: true };
    }
    const key = await getEntityCredential(entity, "thefork");
    const rid = RESTAURANT_ENV[entity];
    if (!key || !rid) return { ok: false, dryRun: false };
    const r = await fetch(`${BASE}/restaurants/${rid}/reviews/${external_id}/reply`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ text: body }),
    });
    return { ok: r.ok, dryRun: false };
  },
};
