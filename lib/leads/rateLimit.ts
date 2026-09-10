// lib/leads/rateLimit.ts
//
// Rate limiting for /api/leads/capture — 5 requests per IP per hour. Backed
// by the leads.ip_hash column (SHA-256 of the client IP, so we never store
// the raw address) with a rolling 60-minute window.
//
// Deliberately DB-backed rather than an in-memory Map: Vercel spins up
// fresh instances for each request, so an in-memory counter resets almost
// every hit. Reading the last hour of leads.ip_hash is cheap given the
// idx_leads_ip_hash_recent index.

import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

// Extract the client's IP from a request. Behind Vercel we get
// x-forwarded-for; local dev gets a plain remote address.
export function extractClientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    // First hop is the actual client — the rest are Vercel's edge chain.
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "0.0.0.0";
}

// SHA-256 hash the IP — never persist the raw address. Salted with a
// per-deploy secret if RATE_LIMIT_SALT is set, else a constant so the
// index still shards well.
export function hashIp(ip: string): string {
  const salt = process.env.RATE_LIMIT_SALT || "leads-funnel-2026-09-11";
  return createHash("sha256").update(salt + "|" + ip).digest("hex");
}

// Returns true when the IP has hit the capture endpoint more than `limit`
// times in the last `windowMs` milliseconds. Caller is expected to drop
// the request silently on overflow (do not echo an error — a chatty error
// message helps abuse tune their loop).
export async function isRateLimited(
  sb: SupabaseClient,
  ipHash: string,
  limit: number = 5,
  windowMs: number = 60 * 60 * 1000,
): Promise<boolean> {
  const since = new Date(Date.now() - windowMs).toISOString();
  const { count, error } = await sb
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .gte("created_at", since);
  if (error) {
    // Fail open: if the count query itself errors, don't lock legitimate
    // guests out — errors here almost always mean the migration hasn't
    // been applied yet in dev.
    return false;
  }
  return typeof count === "number" && count >= limit;
}
