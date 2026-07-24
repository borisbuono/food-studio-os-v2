import crypto from "crypto";
import type { EntityCode } from "@/lib/integrations/types";

// Fresto webhook plumbing — signature verification, entity resolution, event logging.
//
// Fresto signs each webhook with HMAC-SHA256 over the raw JSON body using the
// webhook-specific secret. Header: `X-Fresto-Signature`. See docs.fresto.io "Webhooks".
//
// We accept a SHARED per-tenant secret from FRESTO_WEBHOOK_SECRET (env). If Boris later
// wants per-entity secrets, add FRESTO_WEBHOOK_SECRET_{IFL,BM,BBH} and getWebhookSecret
// will prefer the per-entity variant.

export function getWebhookSecret(entity?: EntityCode): string | null {
  if (entity) {
    const per = process.env[`FRESTO_WEBHOOK_SECRET_${entity}`];
    if (per) return per;
  }
  return process.env.FRESTO_WEBHOOK_SECRET || null;
}

export function verifyFrestoSignature(rawBody: string, signature: string | null, entity?: EntityCode): boolean {
  const secret = getWebhookSecret(entity);
  if (!secret) return false;
  if (!signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature.trim(), "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function resolveEntityFromSlug(slug: string | null | undefined): EntityCode | null {
  const s = String(slug || "").toUpperCase();
  if (s === "IFL" || s === "BM" || s === "BBH") return s as EntityCode;
  return null;
}

// Extract a business date from a payload if present. Fresto's booking payloads carry
// `date` (ISO datetime); Z-report payloads carry either `businessDate` or `toDate`.
export function extractBusinessDate(payload: any): string | null {
  if (!payload) return null;
  const candidates: any[] = [
    payload.businessDate, payload.business_date,
    payload.date, payload.toDate, payload.from_date,
  ];
  for (const c of candidates) {
    if (!c) continue;
    const s = String(c);
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  }
  return null;
}
