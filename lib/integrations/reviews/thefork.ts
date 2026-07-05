import type { ReviewsAdapter } from "@/lib/integrations/types";
export const theForkReviewsAdapter: ReviewsAdapter = {
  name: "TheFork Reviews",
  vendor: "thefork",
  async listReviewsSince() { return []; },
  async postReply() { return { ok: true, dryRun: true }; },
};
