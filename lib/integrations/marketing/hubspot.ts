import type { MarketingAdapter } from "@/lib/integrations/types";
export const hubspotAdapter: MarketingAdapter = {
  name: "HubSpot",
  vendor: "hubspot",
  async pushAudience() { return { external_id: "stub-hubspot-audience", dryRun: true }; },
  async pushCampaign() { return { external_id: "stub-hubspot-campaign", dryRun: true }; },
};
