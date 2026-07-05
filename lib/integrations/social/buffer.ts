import type { SocialAdapter } from "@/lib/integrations/types";
export const bufferAdapter: SocialAdapter = {
  name: "Buffer",
  vendor: "buffer",
  async schedulePost() { return { external_id: "stub-buffer-post", dryRun: true }; },
};
