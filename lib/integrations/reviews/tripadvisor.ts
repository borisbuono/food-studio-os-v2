import type { ReviewsAdapter, ReviewRecord, EntityCode } from "@/lib/integrations/types";
import { getEntityCredential } from "@/lib/integrations/credentials";

// TripAdvisor Content API — read-only for most partners.
// Reply capability is scoped to Owner accounts only (Management API, separate
// enrollment). For now we implement listReviewsSince against Content API and
// leave postReply as a placeholder that logs + returns dryRun.
// Docs: https://developer-tripadvisor.com/content-api/documentation/
//
// Per-entity location id via env for now — settings page in commit #3 will
// let Boris store this per entity_integration row.
//   TRIPADVISOR_LOCATION_{IFL|BM|BBH}
// The stored credential is the Content API key.

const BASE = "https://api.content.tripadvisor.com/api/v1";

const LOCATION_ENV: Record<EntityCode, string | undefined> = {
  IFL: process.env.TRIPADVISOR_LOCATION_IFL,
  BM:  process.env.TRIPADVISOR_LOCATION_BM,
  BBH: process.env.TRIPADVISOR_LOCATION_BBH,
};

function mapReview(raw: any): ReviewRecord {
  return {
    external_id: String(raw.id || ""),
    platform: "tripadvisor",
    author_name: raw.user?.username || raw.user?.name || null,
    rating: typeof raw.rating === "number" ? raw.rating : null,
    body: [raw.title, raw.text].filter(Boolean).join("\n\n"),
    posted_at: raw.published_date || raw.travel_date || new Date().toISOString(),
    reply: null, // Management API only — see file header
    url: raw.url || null,
  };
}

export const tripAdvisorAdapter: ReviewsAdapter = {
  name: "TripAdvisor",
  vendor: "tripadvisor",

  async listReviewsSince(entity: EntityCode, sinceUnixSec: number): Promise<ReviewRecord[]> {
    const key = await getEntityCredential(entity, "tripadvisor");
    const location = LOCATION_ENV[entity];
    if (!key || !location) return [];
    // Content API — key goes in query string per TA convention
    const url = `${BASE}/location/${location}/reviews?key=${encodeURIComponent(key)}&language=en&limit=50`;
    try {
      const r = await fetch(url, { headers: { accept: "application/json" } });
      if (!r.ok) return [];
      const d = await r.json();
      const items: any[] = d.data || [];
      return items
        .map(mapReview)
        .filter((rev) => new Date(rev.posted_at).getTime() / 1000 >= sinceUnixSec);
    } catch {
      return [];
    }
  },

  async postReply(entity: EntityCode, external_id: string, body: string) {
    // TODO: swap for Management API once Owner-account enrollment is confirmed.
    // eslint-disable-next-line no-console
    console.log("[tripadvisor:placeholder] postReply not supported without Owner account enrollment", { entity, external_id, body });
    return { ok: true, dryRun: true };
  },
};
