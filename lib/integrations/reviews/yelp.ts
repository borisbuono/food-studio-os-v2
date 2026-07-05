import type { ReviewsAdapter } from "@/lib/integrations/types";
export const yelpAdapter: ReviewsAdapter = {
  name: "Yelp",
  vendor: "yelp",
  async listReviewsSince() { return []; },
  async postReply() { return { ok: true, dryRun: true }; },
};
