import type { ReviewsAdapter, ReviewRecord, EntityCode } from "@/lib/integrations/types";
import { getEntityCredential } from "@/lib/integrations/credentials";

// Google Business Profile API adapter.
// AUTH REALITY — the Business Profile API requires OAuth 2.0 with scope
// https://www.googleapis.com/auth/business.manage, not a static API key. We
// accept the stored "credential" as an OAuth access token (or a bag of tokens
// as JSON), and the settings page separately captures the account+location IDs
// via env vars for now (per-entity):
//   GOOGLE_BUSINESS_ACCOUNT_{IFL|BM|BBH}   — accounts/{account_id}
//   GOOGLE_BUSINESS_LOCATION_{IFL|BM|BBH}  — locations/{location_id}
// When the OAuth flow lands, both will move into entity_integrations.
// Ref: https://developers.google.com/my-business/reference/rest

const BASE = "https://mybusiness.googleapis.com/v4";
const DRY_RUN = process.env.FS_REVIEWS_DRY_RUN !== "false";

const ACCOUNT_ENV: Record<EntityCode, string | undefined> = {
  IFL: process.env.GOOGLE_BUSINESS_ACCOUNT_IFL,
  BM:  process.env.GOOGLE_BUSINESS_ACCOUNT_BM,
  BBH: process.env.GOOGLE_BUSINESS_ACCOUNT_BBH,
};
const LOCATION_ENV: Record<EntityCode, string | undefined> = {
  IFL: process.env.GOOGLE_BUSINESS_LOCATION_IFL,
  BM:  process.env.GOOGLE_BUSINESS_LOCATION_BM,
  BBH: process.env.GOOGLE_BUSINESS_LOCATION_BBH,
};

function locationPath(entity: EntityCode): string | null {
  const account = ACCOUNT_ENV[entity];
  const location = LOCATION_ENV[entity];
  if (!account || !location) return null;
  return `accounts/${account}/locations/${location}`;
}

function mapReview(raw: any): ReviewRecord {
  // Google encodes 1..5 as STAR_ONE..STAR_FIVE
  const map: Record<string, number> = { STAR_ONE: 1, STAR_TWO: 2, STAR_THREE: 3, STAR_FOUR: 4, STAR_FIVE: 5 };
  return {
    external_id: raw.reviewId || raw.name || "",
    platform: "google",
    author_name: raw.reviewer?.displayName || null,
    rating: typeof raw.starRating === "string" ? (map[raw.starRating] ?? null) : (typeof raw.starRating === "number" ? raw.starRating : null),
    body: raw.comment || "",
    posted_at: raw.createTime || new Date().toISOString(),
    reply: raw.reviewReply ? { body: raw.reviewReply.comment || "", posted_at: raw.reviewReply.updateTime || raw.reviewReply.createTime || "" } : null,
    url: raw.name ? `https://business.google.com/reviews/l/${raw.name}` : null,
  };
}

export const googleBusinessAdapter: ReviewsAdapter = {
  name: "Google Business",
  vendor: "google-business",

  async listReviewsSince(entity: EntityCode, sinceUnixSec: number): Promise<ReviewRecord[]> {
    const token = await getEntityCredential(entity, "google-business");
    const path = locationPath(entity);
    if (!token || !path) return [];
    const url = `${BASE}/${path}/reviews?pageSize=50`;
    try {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) return [];
      const d = await r.json();
      const items: any[] = d.reviews || [];
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
      console.log("[google-business:dry-run] would PUT reply", { entity, external_id, body });
      return { ok: true, dryRun: true };
    }
    const token = await getEntityCredential(entity, "google-business");
    const path = locationPath(entity);
    if (!token || !path) return { ok: false, dryRun: false };
    // GBP review name shape is accounts/{a}/locations/{l}/reviews/{reviewId}
    // Accept either the reviewId or a full name in external_id.
    const reviewPath = external_id.includes("/") ? external_id : `${path}/reviews/${external_id}`;
    const r = await fetch(`${BASE}/${reviewPath}/reply`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ comment: body }),
    });
    return { ok: r.ok, dryRun: false };
  },
};
