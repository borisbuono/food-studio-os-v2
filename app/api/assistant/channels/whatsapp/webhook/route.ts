import { supabaseServer } from "@/lib/supabaseServer";
import { decryptSecret } from "@/lib/integrations/vault";
import { verifyWebhookSignature } from "@/lib/assistant/channels/whatsapp-business";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// WhatsApp Business Cloud API webhook receiver — Assistant Sprint 4 · #1.
//
// GET  — Meta's initial verification handshake. Returns hub.challenge if the
//        hub.verify_token matches META_WA_VERIFY_TOKEN (env). See
//        https://developers.facebook.com/docs/graph-api/webhooks/getting-started/
//
// POST — inbound events (messages + delivery statuses). We verify the
//        X-Hub-Signature-256 header against each candidate channel's stored
//        app_secret (a webhook is registered at the app level; one Meta app
//        can host multiple business phone numbers, so we match on
//        entry[].id === waba_id and phone_number_id when present).
//
// Every event is upserted into `assistant_wa_events`. The inbox surface reads
// from that table — this receiver does no rendering, no drafting.

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge") || "";
  const expected = process.env.META_WA_VERIFY_TOKEN || "";
  if (mode === "subscribe" && token && expected && token === expected) {
    return new Response(challenge, { status: 200, headers: { "content-type": "text/plain" } });
  }
  return new Response("forbidden", { status: 403 });
}

export async function POST(req: Request) {
  // Read the raw body once — signature verification and JSON parse both need it.
  const raw = await req.text();
  const sig = req.headers.get("x-hub-signature-256");
  let body: any;
  try { body = JSON.parse(raw); } catch {
    return Response.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const entries: any[] = Array.isArray(body?.entry) ? body.entry : [];
  if (!entries.length) return Response.json({ ok: true, ignored: "no entries" });

  const sb = supabaseServer();

  // For each entry we need to find the assistant_channels row this event
  // belongs to. The entry id is the WhatsApp Business Account id, and each
  // change.value contains the phone_number_id under `metadata`. We match on
  // both, cross-referencing entity_integrations.meta.
  //
  // The first channel whose stored app_secret verifies the signature wins.
  // If no channel is found the event is dropped silently — this is Meta's
  // recommended behaviour to avoid leaking whether a number is provisioned.
  const nowIso = new Date().toISOString();
  let stored = 0;
  let matchedChannelId: string | null = null;
  let sigOk = false;

  for (const entry of entries) {
    const wabaId = String(entry?.id || "");
    const changes: any[] = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const ch of changes) {
      const value = ch?.value || {};
      const phoneNumberId = String(value?.metadata?.phone_number_id || "");

      // Locate the entity_integrations row for this business phone number.
      // meta->>phone_number_id is set by persistAuthForChannel.
      const { data: intRows } = await sb.from("entity_integrations")
        .select("id,encrypted_key,key_iv,key_tag,meta")
        .eq("platform", "whatsapp-business")
        .is("revoked_at", null);
      const intMatch = (intRows || []).find((r: any) => (r.meta?.phone_number_id || "") === phoneNumberId
        || (r.meta?.business_account_id || "") === wabaId);
      if (!intMatch) continue;

      // Decrypt the auth blob to get app_secret (for signature verification).
      let appSecret = "";
      try {
        const plain = decryptSecret({
          encrypted_key: intMatch.encrypted_key as string,
          key_iv: intMatch.key_iv as string,
          key_tag: intMatch.key_tag as string,
        });
        const auth = JSON.parse(plain);
        appSecret = String(auth?.app_secret || "");
      } catch { /* fall through — appSecret stays empty */ }

      // Verify signature. If META_WA_ALLOW_UNSIGNED=1 (dev) we skip.
      const allowUnsigned = process.env.META_WA_ALLOW_UNSIGNED === "1";
      if (!allowUnsigned) {
        if (!appSecret) continue; // no secret stored → cannot verify → drop
        if (!verifyWebhookSignature(raw, sig, appSecret)) continue;
      }
      sigOk = true;

      // Find the assistant_channels row referencing this entity_integrations id.
      const { data: chan } = await sb.from("assistant_channels")
        .select("id,user_id,settings")
        .eq("auth_ref", intMatch.id)
        .eq("channel_type", "whatsapp_business")
        .is("revoked_at", null)
        .maybeSingle();
      if (!chan) continue;
      matchedChannelId = chan.id as string;

      // Inbound messages.
      const messages: any[] = Array.isArray(value?.messages) ? value.messages : [];
      for (const m of messages) {
        const from_number = String(m.from || "");
        const wa_message_id = String(m.id || "");
        const body_text = String(m?.text?.body || m?.button?.text || m?.interactive?.button_reply?.title || "");
        await sb.from("assistant_wa_events").insert({
          channel_id: chan.id,
          event_type: "message",
          from_number,
          to_number: String(value?.metadata?.display_phone_number || ""),
          body: body_text || null,
          wa_message_id: wa_message_id || null,
          raw: m,
          received_at: nowIso,
        });
        stored++;
      }

      // Delivery statuses.
      const statuses: any[] = Array.isArray(value?.statuses) ? value.statuses : [];
      for (const s of statuses) {
        await sb.from("assistant_wa_events").insert({
          channel_id: chan.id,
          event_type: "status." + String(s.status || "unknown"),
          from_number: null,
          to_number: String(s.recipient_id || ""),
          body: null,
          wa_message_id: String(s.id || "") || null,
          raw: s,
          received_at: nowIso,
        });
        stored++;
      }
    }
  }

  return Response.json({ ok: true, stored, matched: matchedChannelId, verified: sigOk });
}
