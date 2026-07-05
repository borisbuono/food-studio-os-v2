import type { SocialAdapter } from "@/lib/integrations/types";
export const laterAdapter: SocialAdapter = {
  name: "Later",
  vendor: "later",
  async schedulePost() { return { external_id: "stub-later-post", dryRun: true }; },
};
