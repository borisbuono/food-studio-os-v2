// lib/email/classify.ts — E1 placeholder. E2 fills this in: rules first
// (sender allow/deny lists, Holded/Fresto senders), Haiku second; then routes
// enquiry / supplier_doc / fiscal_legal / booking_change / newsletter_noise /
// other. Until then every pulled thread sits at status 'new' and nothing is
// labelled, captured or drafted.
import type { SupabaseClient } from "@supabase/supabase-js";

export async function sweepNewThreads(_svc: SupabaseClient, _opts: { entityId?: string | null } = {}): Promise<{ classified: number; skipped: string }> {
  return { classified: 0, skipped: "E2 not shipped" };
}
