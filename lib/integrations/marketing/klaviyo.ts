import type { MarketingAdapter } from "@/lib/integrations/types";
export const klaviyoAdapter: MarketingAdapter = {
  name: "Klaviyo",
  vendor: "klaviyo",
  async pushAudience() { return { external_id: "stub-klaviyo-audience", dryRun: true }; },
  async pushCampaign() { return { external_id: "stub-klaviyo-campaign", dryRun: true }; },
};
