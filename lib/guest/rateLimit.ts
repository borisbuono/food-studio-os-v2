// Rate limit for the public guest routes that write through the service-role
// client (/api/guest/book, /api/guest/private). Audit 26-09 P1-2: both wrote
// guests rows and sent email with no cap. Backed by booking_attempts
// (slug, ip_hash, created_at) — RLS deny-all, service-role only — so the raw
// IP is never stored and the counter survives Vercel's per-request instances.
//
// Returns true when this IP has already made `limit` attempts on this venue in
// the window. Records the attempt either way. Fails OPEN on a DB error (a
// guest must not be locked out by a missing table), like lib/leads/rateLimit.

import type { SupabaseClient } from "@supabase/supabase-js";
import { extractClientIp, hashIp } from "@/lib/leads/rateLimit";

export async function guestRateLimited(sb: SupabaseClient, req: Request, slug: string, limit = 6, windowMs = 60 * 60 * 1000): Promise<boolean> {
  const ip_hash = hashIp(extractClientIp(req));
  const since = new Date(Date.now() - windowMs).toISOString();
  try {
    const { count, error } = await sb.from("booking_attempts").select("id", { count: "exact", head: true })
      .eq("ip_hash", ip_hash).eq("slug", slug).gte("created_at", since);
    if (error) return false;
    await sb.from("booking_attempts").insert({ slug, ip_hash });
    return typeof count === "number" && count >= limit;
  } catch {
    return false;
  }
}
