import type { MarketingAdapter } from "@/lib/integrations/types";
export const mailchimpAdapter: MarketingAdapter = {
  name: "Mailchimp",
  vendor: "mailchimp",
  async pushAudience() { return { external_id: "stub-mailchimp-audience", dryRun: true }; },
  async pushCampaign() { return { external_id: "stub-mailchimp-campaign", dryRun: true }; },
};
