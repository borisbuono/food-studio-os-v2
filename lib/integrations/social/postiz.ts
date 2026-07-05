import type { SocialAdapter } from "@/lib/integrations/types";
export const postizAdapter: SocialAdapter = {
  name: "Postiz",
  vendor: "postiz",
  async schedulePost() { return { external_id: "stub-postiz-post", dryRun: true }; },
};
