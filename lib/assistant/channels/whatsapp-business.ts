// WhatsApp Business Cloud API — Assistant Sprint 4 · #1.
//
// This is the "company lines at scale" channel. Meta's Graph API is used for:
//   - sending outbound text messages (freeform, inside the 24-hour window)
//   - sending approved message templates (for outbound outside the window)
//   - reading inbound messages + delivery status via webhook events written
//     to `assistant_wa_events` by the receiver route
//
// Auth model mirrors Gmail's: an `entity_integrations` row (referenced by
// `assistant_channels.auth_ref`) holds an encrypted JSON blob with:
//   { access_token, phone_number_id, business_account_id?, app_secret? }
// The token is long-lived — Meta system-user tokens don't expire on the
// same cadence as Google's, so we don't wire a refresh flow. If the token
// is invalidated the /me probe returns 401 and the settings surface warns.
//
// Draft-first everywhere: `sendMessage` refuses unless `channel.settings`
// `auto_send` or `supervised_send` is true. Same gates as Gmail.
//
// v1 for personal WhatsApp lines is in the sibling `whatsapp-desktop.ts`
// (draft-queue only). v2 evolves personal lines to Business Cloud API as
// Meta opens up multi-device.

import { supabaseServer } from "@/lib/supabaseServer";
import { encryptSecret, decryptSecret } from "@/lib/integrations/vault";
import type { AssistantChannelRow } from "@/types/db";

const GRAPH_BASE = "https://graph.facebook.com/v20.0";

export type WaBusinessAuth = {
  access_token: string;
  phone_number_id: string;
  business_account_id?: string | null;
  app_secret?: string | null; // used to verify inbound webhook signatures
};

// --------------------------------------------------------------------------
// Vault helpers — encrypted JSON blob in entity_integrations.
// --------------------------------------------------------------------------

async function loadAuth(auth_ref: string | null): Promise<{ auth: WaBusinessAuth; rowId: string } | null> {
  if (!auth_ref) return null;
  const sb = supabaseServer();
  const { data } = await sb.from("entity_integrations")
    .select("id,encrypted_key,key_iv,key_tag")
    .eq("id", auth_ref)
    .is("revoked_at", null)
    .maybeSingle();
  if (!data?.encrypted_key || !data.key_iv || !data.key_tag) return null;
  try {
    const plain = decryptSecret({
      encrypted_key: data.encrypted_key as string,
      key_iv: data.key_iv as string,
      key_tag: data.key_tag as string,
    });
    return { auth: JSON.parse(plain) as WaBusinessAuth, rowId: data.id as string };
  } catch {
    return null;
  }
}

export async function persistAuthForChannel(opts: {
  userId: string;
  entity: "IFL" | "BM" | "BBH";
  auth: WaBusinessAuth;
  display_number?: string | null;
}): Promise<string> {
  const sb = supabaseServer();
  const enc = encryptSecret(JSON.stringify(opts.auth));

  await sb.from("entity_integrations")
    .update({ revoked_at: new Date().toISOString() })
    .eq("entity_code", opts.entity)
    .eq("platform", "whatsapp-business")
    .eq("display_name", `whatsapp-business · ${opts.auth.phone_number_id}`)
    .is("revoked_at", null);

  const { data, error } = await sb.from("entity_integrations").insert({
    entity_code: opts.entity,
    platform: "whatsapp-business",
    integration_type: "messaging",
    display_name: `whatsapp-business · ${opts.auth.phone_number_id}`,
    encrypted_key: enc.encrypted_key,
    key_iv: enc.key_iv,
    key_tag: enc.key_tag,
    status: "connected",
    last_check_at: new Date().toISOString(),
    added_by: opts.userId,
    rotated_at: new Date().toISOString(),
    meta: {
      channel: "whatsapp-business",
      phone_number_id: opts.auth.phone_number_id,
      display_number: opts.display_number || null,
      business_account_id: opts.auth.business_account_id || null,
    },
  }).select("id").maybeSingle();
  if (error || !data?.id) throw new Error("could not persist whatsapp-business auth: " + (error?.message || "no row"));
  return data.id as string;
}

// --------------------------------------------------------------------------
// Rate limits — Business Cloud API tiers: 250 / 1k / 10k / 100k / unlimited
// unique daily conversations per business phone number. We track per-channel
// per-minute call counts and warn once we cross 60 (Meta throttles well below
// documented limits in practice).
// --------------------------------------------------------------------------

const rateWindows = new Map<string, { start: number; count: number }>();

function noteCall(channelId: string, weight = 1): { warn: boolean; usedInWindow: number } {
  const now = Date.now();
  const bucket = rateWindows.get(channelId);
  if (!bucket || now - bucket.start > 60_000) {
    rateWindows.set(channelId, { start: now, count: weight });
    return { warn: false, usedInWindow: weight };
  }
  bucket.count += weight;
  const warn = bucket.count > 60;
  if (warn) console.warn(`[wa-business] rate window ${bucket.count} calls in the past minute (channel ${channelId}); tier throttle risk`);
  return { warn, usedInWindow: bucket.count };
}

// --------------------------------------------------------------------------
// HTTP helpers
// --------------------------------------------------------------------------

async function waFetch(channel: AssistantChannelRow, path: string, init?: RequestInit): Promise<any> {
  const loaded = await loadAuth(channel.auth_ref);
  if (!loaded) throw new Error("whatsapp-business channel missing vault entry");
  const { auth } = loaded;
  const url = path.startsWith("http") ? path : GRAPH_BASE + path;
  const r = await fetch(url, {
    ...(init || {}),
    headers: {
      ...(init?.headers || {}),
      "authorization": "Bearer " + auth.access_token,
      "accept": "application/json",
    },
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`whatsapp-business ${r.status} ${path}: ${text.slice(0, 200)}`);
  }
  return await r.json();
}

// --------------------------------------------------------------------------
// Public API — used by triage + inbox surface + FAB.
// --------------------------------------------------------------------------

export type WaSendResult = { wa_message_id: string };

// Normalise a phone number to Meta's expected E.164-without-plus. Accepts
// "+34 664 21 32 27" or "+34664213227"; returns "34664213227".
function normaliseTo(to: string): string {
  return String(to || "").replace(/[^0-9]/g, "");
}

// sendMessage — freeform text, inside the 24-hour customer service window.
export async function sendMessage(channel: AssistantChannelRow, input: { to: string; body: string }): Promise<WaSendResult> {
  const settings = (channel.settings || {}) as any;
  const canSend = !!settings.auto_send || !!settings.supervised_send;
  if (!canSend) {
    throw new Error("send blocked: this channel is Draft-only — flip to Supervised send in Assistant Settings before sending");
  }
  noteCall(channel.id, 1);
  const loaded = await loadAuth(channel.auth_ref);
  if (!loaded) throw new Error("whatsapp-business channel missing vault entry");
  const to = normaliseTo(input.to);
  if (!to) throw new Error("sendMessage: `to` must be a phone number");
  const body = (input.body || "").slice(0, 4096); // Meta caps at 4096 chars
  if (!body) throw new Error("sendMessage: body is empty");

  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { body, preview_url: false },
  };
  const j = await waFetch(channel, `/${encodeURIComponent(loaded.auth.phone_number_id)}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const wa_message_id = j?.messages?.[0]?.id || "";
  return { wa_message_id };
}

// sendTemplate — approved message template (required for outbound outside
// the 24-hour window). `template_name` + `language` must match an approved
// template on the Business account. `params` are substituted into the
// {{1}}, {{2}} … placeholders in the template body.
export async function sendTemplate(channel: AssistantChannelRow, input: {
  to: string; template_name: string; language?: string; params?: (string | number)[];
}): Promise<WaSendResult> {
  const settings = (channel.settings || {}) as any;
  const canSend = !!settings.auto_send || !!settings.supervised_send;
  if (!canSend) {
    throw new Error("send blocked: this channel is Draft-only — flip to Supervised send in Assistant Settings before sending");
  }
  noteCall(channel.id, 1);
  const loaded = await loadAuth(channel.auth_ref);
  if (!loaded) throw new Error("whatsapp-business channel missing vault entry");
  const to = normaliseTo(input.to);
  if (!to) throw new Error("sendTemplate: `to` must be a phone number");
  const language = input.language || "en_US";
  const params = (input.params || []).map((p) => ({ type: "text", text: String(p) }));

  const payload: any = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: input.template_name,
      language: { code: language },
      components: params.length ? [{ type: "body", parameters: params }] : undefined,
    },
  };
  const j = await waFetch(channel, `/${encodeURIComponent(loaded.auth.phone_number_id)}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const wa_message_id = j?.messages?.[0]?.id || "";
  return { wa_message_id };
}

// listWebhookEvents — the webhook receiver writes rows into assistant_wa_events;
// triage + surface read from here. Filter to a single channel + optional
// `since` timestamp.
export async function listWebhookEvents(channel: AssistantChannelRow, since?: Date, limit = 50): Promise<Array<{
  id: string; event_type: string; from_number: string | null; to_number: string | null;
  body: string | null; wa_message_id: string | null; received_at: string;
}>> {
  const sb = supabaseServer();
  let q = sb.from("assistant_wa_events")
    .select("id,event_type,from_number,to_number,body,wa_message_id,received_at")
    .eq("channel_id", channel.id)
    .order("received_at", { ascending: false })
    .limit(Math.max(1, Math.min(200, limit)));
  if (since) q = q.gte("received_at", since.toISOString());
  const { data } = await q;
  return (data || []) as any[];
}

// Health probe used by /api/integrations/connect for `whatsapp-business` —
// hits Meta's /me endpoint (returns the token owner). Also verifies the
// phone_number_id resolves against the token by fetching its profile.
export async function testWaBusinessAccessToken(access_token: string, phone_number_id?: string): Promise<{ ok: boolean; user_id?: string; display_number?: string; error?: string }> {
  try {
    const me = await fetch(`${GRAPH_BASE}/me`, { headers: { "authorization": "Bearer " + access_token } });
    if (!me.ok) {
      const t = await me.text().catch(() => "");
      return { ok: false, error: `whatsapp /me ${me.status}: ${t.slice(0, 200)}` };
    }
    const meJson: any = await me.json();
    let display_number: string | undefined;
    if (phone_number_id) {
      const pn = await fetch(`${GRAPH_BASE}/${encodeURIComponent(phone_number_id)}?fields=display_phone_number,verified_name`, {
        headers: { "authorization": "Bearer " + access_token },
      });
      if (pn.ok) {
        const pj: any = await pn.json();
        display_number = String(pj.display_phone_number || "");
      } else {
        const t = await pn.text().catch(() => "");
        return { ok: false, error: `whatsapp /phone ${pn.status}: ${t.slice(0, 200)}` };
      }
    }
    return { ok: true, user_id: String(meJson.id || ""), display_number };
  } catch (e: any) {
    return { ok: false, error: e?.message || "whatsapp probe failed" };
  }
}

// verifyWebhookSignature — Meta signs every webhook with
// `X-Hub-Signature-256: sha256=<hex>` derived from the raw request body +
// the app secret. We compute the same HMAC and compare in constant time.
export function verifyWebhookSignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header || !appSecret) return false;
  const parts = header.split("=");
  if (parts.length !== 2 || parts[0] !== "sha256") return false;
  const given = parts[1];
  try {
    const { createHmac, timingSafeEqual } = require("crypto");
    const mac = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
    if (mac.length !== given.length) return false;
    return timingSafeEqual(Buffer.from(mac, "hex"), Buffer.from(given, "hex"));
  } catch {
    return false;
  }
}
