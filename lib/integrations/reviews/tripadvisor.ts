import type { ReviewsAdapter } from "@/lib/integrations/types";
export const tripAdvisorAdapter: ReviewsAdapter = {
  name: "TripAdvisor",
  vendor: "tripadvisor",
  async listReviewsSince() { return []; },
  async postReply() { return { ok: true, dryRun: true }; },
};
