import type { MarketingAdapter } from "@/lib/integrations/types";
// Wix Newsletter — because BM/IFL's landing pages live on Wix today. Stub
// until the ascend/email endpoint is wired.
export const wixNewsletterAdapter: MarketingAdapter = {
  name: "Wix Newsletter",
  vendor: "wix-newsletter",
  async pushAudience() { return { external_id: "stub-wix-audience", dryRun: true }; },
  async pushCampaign() { return { external_id: "stub-wix-campaign", dryRun: true }; },
};
