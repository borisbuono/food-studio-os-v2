// POST /api/leads/capture — public lead capture endpoint.
//
// Overnight 2026-09-11 scaffolding. Accepts a lightweight lead payload
// from any external form (website, embedded widget, Instagram link,
// referral partner). The endpoint is deliberately conservative:
//
//   * Public — allow-listed in middleware so anon submissions reach it.
//   * Rate-limited — 5 hits / IP / hour, gated by leads.ip_hash lookback.
//   * Honeypot — a `website_url` field is a trap. Any submission that
//     sets it is silently dropped (bots often fill every text input).
//   * Silent on abuse — we always return `{ ok: true }` when the payload
//     shape is valid, whether or not we actually inserted a row, so an
//     abuser can't discriminate accepted from rejected inputs.
//   * No enumeration — the response never echoes the inserted id.
//
// The service-role client (guestServiceClient) is required because RLS on
// leads is authenticated-all; the anon submission goes through this route
// which validates and then writes on the guest's behalf, matching the
// same pattern used by /api/guest/book.

import { guestServiceClient } from "@/lib/guest/serviceClient";
import { resolveEntityIdForSlug } from "@/lib/leads/entityResolve";
import { extractClientIp, hashIp, isRateLimited } from "@/lib/leads/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Payload = {
  entity_slug?: string;
  source?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  landing_url?: string;
  referrer_url?: string;
  email?: string;
  phone?: string;
  name?: string;
  party_size?: number | string;
  intent?: string;
  requested_date?: string;
  message?: string;
  // Honeypot — legit clients never populate this. Any value → silent drop.
  website_url?: string;
};

const ALLOWED_SOURCES = new Set([
  "website", "instagram", "referral", "walk-in", "inbound-email", "unknown",
]);
const ALLOWED_INTENTS = new Set([
  "booking", "event", "private-dining", "catering", "general",
]);

function truncate(s: string | undefined | null, n: number): string | null {
  if (!s) return null;
  const v = String(s).trim();
  if (!v) return null;
  return v.length > n ? v.slice(0, n) : v;
}

function isEmailish(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export async function POST(req: Request) {
  const ok = () => Response.json({ ok: true });

  let body: Payload = {};
  try {
    body = await req.json();
  } catch {
    // Malformed JSON — still return ok:true to keep the endpoint silent.
    // The bad request bounced off validation, not the DB.
    return ok();
  }

  // Honeypot — bots fill every field; humans don't see this one.
  if (typeof body.website_url === "string" && body.website_url.trim() !== "") {
    return ok();
  }

  // Minimal payload shape — need at least one contact hook (email or phone).
  const email = truncate(body.email, 254);
  const phone = truncate(body.phone, 40);
  const name  = truncate(body.name, 120);
  if (!email && !phone) return ok();
  if (email && !isEmailish(email)) return ok();

  const sb = guestServiceClient;

  // Rate limit — 5 per IP per hour. Hash the IP; never store the raw.
  const ip = extractClientIp(req);
  const ipHash = hashIp(ip);
  try {
    if (await isRateLimited(sb, ipHash)) return ok();
  } catch {
    // Table missing / RLS quirk — fail open.
  }

  // Resolve entity_slug → entity_id. Unknown slug is treated as an
  // umbrella (studio-level) lead so nothing goes into the void.
  let entityId: string | null = null;
  if (body.entity_slug) {
    const resolved = await resolveEntityIdForSlug(sb, String(body.entity_slug));
    entityId = resolved?.entityId ?? null;
  }

  // Party size — coerce, clamp, drop garbage.
  let partySize: number | null = null;
  if (body.party_size !== undefined && body.party_size !== null && body.party_size !== "") {
    const n = Number(body.party_size);
    if (Number.isFinite(n) && n >= 1 && n <= 200) partySize = Math.floor(n);
  }

  // Requested date — must be yyyy-mm-dd if present.
  let requestedDate: string | null = null;
  if (body.requested_date && /^\d{4}-\d{2}-\d{2}$/.test(String(body.requested_date))) {
    requestedDate = String(body.requested_date);
  }

  const source = ALLOWED_SOURCES.has(String(body.source || "").toLowerCase())
    ? String(body.source).toLowerCase()
    : "website";
  const intent = ALLOWED_INTENTS.has(String(body.intent || "").toLowerCase())
    ? String(body.intent).toLowerCase()
    : null;

  const row = {
    entity_id: entityId,
    source,
    utm_source:   truncate(body.utm_source,   200),
    utm_medium:   truncate(body.utm_medium,   200),
    utm_campaign: truncate(body.utm_campaign, 200),
    utm_content:  truncate(body.utm_content,  200),
    utm_term:     truncate(body.utm_term,     200),
    landing_url:  truncate(body.landing_url,  2048),
    referrer_url: truncate(body.referrer_url, 2048),
    email: email ? email.toLowerCase() : null,
    phone,
    name,
    party_size: partySize,
    intent,
    requested_date: requestedDate,
    message: truncate(body.message, 4000),
    state: "new",
    ip_hash: ipHash,
    state_history: [
      { at: new Date().toISOString(), state: "new", by: "capture", source },
    ] as unknown as object,
  };

  try {
    await sb.from("leads").insert(row);
  } catch {
    // Never leak the DB error shape to an anon client.
  }

  return ok();
}
