// Signed tokens for guest self-service surfaces (preferences + feedback).
//
// Design: HS256 JWT with app-provided secret. Never require a login — guests
// arrive from an emailed link, so the token IS their proof of identity for
// the narrow scope of their own booking + guest row.
//
// 90-day expiry (spec). Payload carries { g: guest_id, b: booking_id?, k: kind }
// so a single token authorises both /preferences and /thanks flows for one
// booking. Booking-less tokens are supported for the newsletter path.
//
// No external JWT lib — Web Crypto only, so this runs on the Edge runtime.

import { createHmac, timingSafeEqual } from "node:crypto";

export type GuestTokenPayload = {
  g: string;                      // guest id
  b?: string | null;              // booking id
  r?: string | null;              // restaurant id
  k: "preferences" | "thanks";
  exp: number;                    // seconds since epoch
  iat: number;
};

const B64 = (buf: Buffer | Uint8Array): string =>
  Buffer.from(buf).toString("base64").replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");

const UNB64 = (s: string): Buffer =>
  Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4), "base64");

// P0-7 (audit 2026-09-26): the old fallback signed with the PUBLIC anon key,
// so with GUEST_TOKEN_SECRET unset anyone could forge a guest link. No fallback.
// Fails loudly at module load on the server (not during `next build`, which
// may not have runtime env) so a missing var is a 500 with a clear message on
// the guest routes, never a silently forgeable token.
const GUEST_SECRET_MISSING =
  "GUEST_TOKEN_SECRET is not set. Guest self-service links cannot be signed or verified. " +
  "Add GUEST_TOKEN_SECRET (>= 32 random chars) to the environment and redeploy.";

function secret(): string {
  const s = process.env.GUEST_TOKEN_SECRET;
  if (!s || s.length < 16) throw new Error(GUEST_SECRET_MISSING);
  return s;
}

if (
  typeof process !== "undefined" &&
  process.env.NEXT_PHASE !== "phase-production-build" &&
  process.env.NODE_ENV === "production" &&
  !process.env.GUEST_TOKEN_SECRET
) {
  throw new Error(GUEST_SECRET_MISSING);
}

const NINETY_DAYS = 90 * 24 * 60 * 60;

export function signGuestToken(
  payload: Omit<GuestTokenPayload, "exp" | "iat"> & { ttlSeconds?: number }
): string {
  const now = Math.floor(Date.now() / 1000);
  const body: GuestTokenPayload = {
    ...payload,
    iat: now,
    exp: now + (payload.ttlSeconds ?? NINETY_DAYS),
  };
  const header = B64(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const bodyB64 = B64(Buffer.from(JSON.stringify(body)));
  const signingInput = `${header}.${bodyB64}`;
  const sig = createHmac("sha256", secret()).update(signingInput).digest();
  return `${signingInput}.${B64(sig)}`;
}

export function verifyGuestToken(token: string): GuestTokenPayload | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expected = createHmac("sha256", secret()).update(`${header}.${body}`).digest();
  let given: Buffer;
  try { given = UNB64(sig); } catch { return null; }
  if (given.length !== expected.length) return null;
  if (!timingSafeEqual(given, expected)) return null;
  let payload: GuestTokenPayload;
  try { payload = JSON.parse(UNB64(body).toString("utf8")); } catch { return null; }
  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp < now) return null;
  return payload;
}
