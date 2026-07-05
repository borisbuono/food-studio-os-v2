import type { ReviewsAdapter } from "@/lib/integrations/types";
export const googleBusinessAdapter: ReviewsAdapter = {
  name: "Google Business",
  vendor: "google-business",
  async listReviewsSince() { return []; },
  async postReply() { return { ok: true, dryRun: true }; },
};
