// Gmail edge connector for the Assistant Layer.
//
// Sprint 3 · #1. This module is the only place that speaks Gmail. Triage
// (Sprint 3 · #2) and the /grow/inbox surface (Sprint 3 · #3) both go
// through here. WhatsApp (Sprint 4) has its own sibling under channels/.
//
// Auth model:
// - The user connects Gmail via OAuth on the Assistant Settings page.
// - The refresh_token (and the current access_token snapshot) are stored in
//   `entity_integrations` — encrypted at rest with AES-256-GCM via the same
//   vault the rest of the OS uses (lib/integrations/vault.ts).
// - `assistant_channels.auth_ref` is the entity_integrations row id, so
//   the row is scoped to (user, entity_code=IFL, platform="gmail").
// - Access tokens are refreshed on demand and the fresh access_token is
//   written back so the next call skips the refresh round-trip.
//
// Draft-first everywhere: `sendDraft` refuses unless the channel's
// `settings.auto_send` flag is true. The default UI puts every operator in
// "Draft only" mode.

import { supabaseServer } from "@/lib/supabaseServer";
import { encryptSecret, decryptSecret } from "@/lib/integrations/vault";
import type { AssistantChannelRow } from "@/types/db";

// Gmail auth blob we keep in the vault. Stored as encrypted JSON so the vault
// only needs a single ciphertext per token set.
type GmailAuth = {
  refresh_token: string;
  access_token?: string | null;
  access_token_expires_at?: number | null; // epoch seconds
  scope?: string | null;
  token_type?: string | null;
};

const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/userinfo.email",
];
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";

export function gmailScopeString() {
  return GMAIL_SCOPES.join(" ");
}

// --------------------------------------------------------------------------
// Vault helpers — encrypted JSON blob in entity_integrations for Gmail auth.
// --------------------------------------------------------------------------

async function loadAuth(auth_ref: string | null): Promise<{ auth: GmailAuth; rowId: string } | null> {
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
    return { auth: JSON.parse(plain) as GmailAuth, rowId: data.id as string };
  } catch {
    return null;
  }
}

async function saveAuth(rowId: string, auth: GmailAuth) {
  const sb = supabaseServer();
  const enc = encryptSecret(JSON.stringify(auth));
  await sb.from("entity_integrations").update({
    encrypted_key: enc.encrypted_key,
    key_iv: enc.key_iv,
    key_tag: enc.key_tag,
    last_check_at: new Date().toISOString(),
    rotated_at: new Date().toISOString(),
  }).eq("id", rowId);
}

// Create the vault row that will hold the Gmail auth blob. Returns the id
// (used as `assistant_channels.auth_ref`).
export async function persistAuthForChannel(opts: {
  userId: string;
  entity: "IFL" | "BM" | "BBH";
  email: string;
  auth: GmailAuth;
}): Promise<string> {
  const sb = supabaseServer();
  const enc = encryptSecret(JSON.stringify(opts.auth));

  // Revoke any previous gmail row for this entity+user pair — we key on the
  // Google email so the same operator can reconnect after a scope change.
  await sb.from("entity_integrations")
    .update({ revoked_at: new Date().toISOString() })
    .eq("entity_code", opts.entity)
    .eq("platform", "gmail")
    .eq("display_name", `gmail · ${opts.email}`)
    .is("revoked_at", null);

  const { data, error } = await sb.from("entity_integrations").insert({
    entity_code: opts.entity,
    platform: "gmail",
    integration_type: "email",
    display_name: `gmail · ${opts.email}`,
    encrypted_key: enc.encrypted_key,
    key_iv: enc.key_iv,
    key_tag: enc.key_tag,
    status: "connected",
    last_check_at: new Date().toISOString(),
    added_by: opts.userId,
    rotated_at: new Date().toISOString(),
    meta: { channel: "gmail", email: opts.email, scope: opts.auth.scope || null },
  }).select("id").maybeSingle();
  if (error || !data?.id) throw new Error("could not persist gmail auth: " + (error?.message || "no row"));
  return data.id as string;
}

// --------------------------------------------------------------------------
// Access token refresh — with per-invocation cache
// --------------------------------------------------------------------------

const tokenCache = new Map<string, { token: string; expires_at: number }>();

async function accessToken(channel: AssistantChannelRow): Promise<string> {
  if (!channel.auth_ref) throw new Error("gmail channel missing auth_ref");
  const cached = tokenCache.get(channel.auth_ref);
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.expires_at > now + 60) return cached.token;

  const loaded = await loadAuth(channel.auth_ref);
  if (!loaded) throw new Error("gmail vault entry missing or unreadable");
  const { auth, rowId } = loaded;

  // Reuse the stored access token if it hasn't expired.
  if (auth.access_token && auth.access_token_expires_at && auth.access_token_expires_at > now + 60) {
    tokenCache.set(channel.auth_ref, { token: auth.access_token, expires_at: auth.access_token_expires_at });
    return auth.access_token;
  }

  // Refresh via Google's token endpoint.
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("GOOGLE_OAUTH_CLIENT_ID / _SECRET not configured");

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: auth.refresh_token,
    grant_type: "refresh_token",
  });
  const r = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`google token refresh ${r.status}: ${t.slice(0, 200)}`);
  }
  const j: any = await r.json();
  const token = String(j.access_token || "");
  const ttl = Number(j.expires_in || 3600);
  const expires_at = now + ttl;
  const merged: GmailAuth = {
    ...auth,
    access_token: token,
    access_token_expires_at: expires_at,
    scope: j.scope || auth.scope || null,
    token_type: j.token_type || auth.token_type || "Bearer",
  };
  await saveAuth(rowId, merged);
  tokenCache.set(channel.auth_ref, { token, expires_at });
  return token;
}

// --------------------------------------------------------------------------
// Rate-limit warning — Gmail's per-user quota is 250 units/second. Draft +
// send are 5 units each, list ~5, get ~5. We track a rough count per channel
// per minute and warn (console + return value) when we cross 200/minute.
// --------------------------------------------------------------------------

const rateWindows = new Map<string, { start: number; count: number }>();

function noteCall(channelId: string, units = 5): { warn: boolean; usedInWindow: number } {
  const now = Date.now();
  const bucket = rateWindows.get(channelId);
  if (!bucket || now - bucket.start > 60_000) {
    rateWindows.set(channelId, { start: now, count: units });
    return { warn: false, usedInWindow: units };
  }
  bucket.count += units;
  const warn = bucket.count > 200;
  if (warn) console.warn(`[gmail] rate window used ${bucket.count} units in the past minute (channel ${channelId})`);
  return { warn, usedInWindow: bucket.count };
}

// --------------------------------------------------------------------------
// Public API — used by triage + draft pipeline + the /grow/inbox surface.
// --------------------------------------------------------------------------

export type GmailThreadSummary = {
  thread_id: string;
  snippet: string;
  history_id?: string | null;
  message_count: number;
  last_message_at: string; // ISO
  from: string;
  subject: string;
  unread: boolean;
};

export type GmailMessage = {
  id: string;
  thread_id: string;
  from: string;
  to: string[];
  subject: string;
  body_text: string;
  received_at: string;
  in_reply_to?: string | null;
  message_id_header?: string | null;
};

export type GmailThread = {
  thread_id: string;
  subject: string;
  from: string;
  messages: GmailMessage[];
};

function b64urlToUtf8(s: string): string {
  const norm = s.replace(/-/g, "+").replace(/_/g, "/") + "==".slice((s.length + 3) % 4);
  try { return Buffer.from(norm, "base64").toString("utf8"); } catch { return ""; }
}

function utf8ToB64url(s: string): string {
  return Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function findHeader(headers: any[] | undefined, name: string): string {
  if (!headers) return "";
  const h = headers.find((x) => (x.name || "").toLowerCase() === name.toLowerCase());
  return h?.value || "";
}

function extractText(payload: any): string {
  if (!payload) return "";
  if (payload.mimeType === "text/plain" && payload.body?.data) return b64urlToUtf8(payload.body.data);
  if (payload.mimeType === "text/html" && payload.body?.data && !payload.parts?.length) {
    // Strip HTML tags very roughly. Triage doesn't need perfect fidelity.
    return b64urlToUtf8(payload.body.data).replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  if (payload.parts && payload.parts.length) {
    const plain = payload.parts.find((p: any) => p.mimeType === "text/plain");
    if (plain) return extractText(plain);
    for (const p of payload.parts) {
      const t = extractText(p);
      if (t) return t;
    }
  }
  return "";
}

// Exposed for feature-specific scanners (e.g. Fresto closing-report email
// guest parser) that need to hit arbitrary Gmail endpoints without
// duplicating the OAuth / refresh plumbing. Internal callers still use
// the un-exported alias.
export async function gmailApiFetch(channel: AssistantChannelRow, path: string, init?: RequestInit): Promise<any> {
  return gmailFetch(channel, path, init);
}

async function gmailFetch(channel: AssistantChannelRow, path: string, init?: RequestInit): Promise<any> {
  const token = await accessToken(channel);
  const r = await fetch(GMAIL_API + path, {
    ...(init || {}),
    headers: {
      ...(init?.headers || {}),
      "authorization": "Bearer " + token,
      "accept": "application/json",
    },
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`gmail ${r.status} ${path}: ${text.slice(0, 200)}`);
  }
  return await r.json();
}

// List recent threads since a given moment. `since` maps to Gmail's `q=after:`
// query (accurate to the day). We fetch metadata for each thread's newest
// message so triage doesn't need a second round-trip.
export async function listRecentThreads(channel: AssistantChannelRow, since: Date): Promise<GmailThreadSummary[]> {
  noteCall(channel.id, 5);
  const days = Math.max(1, Math.round((Date.now() - since.getTime()) / 86_400_000));
  const q = encodeURIComponent(`newer_than:${days}d in:inbox`);
  const list = await gmailFetch(channel, `/users/me/threads?q=${q}&maxResults=25`);
  const threads: any[] = list.threads || [];

  const out: GmailThreadSummary[] = [];
  for (const t of threads) {
    noteCall(channel.id, 5);
    try {
      const full = await gmailFetch(channel, `/users/me/threads/${t.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
      const msgs = full.messages || [];
      const last = msgs[msgs.length - 1] || msgs[0];
      const headers = last?.payload?.headers || [];
      const from = findHeader(headers, "From");
      const subject = findHeader(headers, "Subject");
      const dateHdr = findHeader(headers, "Date");
      const iso = dateHdr ? new Date(dateHdr).toISOString() : new Date(Number(last?.internalDate || Date.now())).toISOString();
      const labels: string[] = last?.labelIds || [];
      out.push({
        thread_id: t.id,
        snippet: (last?.snippet || t.snippet || "").slice(0, 400),
        history_id: full.historyId || null,
        message_count: msgs.length,
        last_message_at: iso,
        from,
        subject: subject || "(no subject)",
        unread: labels.includes("UNREAD"),
      });
    } catch (e: any) {
      console.warn("[gmail] listRecentThreads thread fetch failed", t.id, e?.message);
    }
  }
  return out;
}

export async function getThread(channel: AssistantChannelRow, thread_id: string): Promise<GmailThread> {
  noteCall(channel.id, 10);
  const full = await gmailFetch(channel, `/users/me/threads/${encodeURIComponent(thread_id)}?format=full`);
  const messages: GmailMessage[] = (full.messages || []).map((m: any) => {
    const headers = m.payload?.headers || [];
    const from = findHeader(headers, "From");
    const to = findHeader(headers, "To").split(",").map((s: string) => s.trim()).filter(Boolean);
    const subject = findHeader(headers, "Subject");
    const dateHdr = findHeader(headers, "Date");
    return {
      id: m.id,
      thread_id: m.threadId,
      from,
      to,
      subject,
      body_text: extractText(m.payload),
      received_at: dateHdr ? new Date(dateHdr).toISOString() : new Date(Number(m.internalDate || Date.now())).toISOString(),
      in_reply_to: findHeader(headers, "In-Reply-To") || null,
      message_id_header: findHeader(headers, "Message-ID") || null,
    };
  });
  const first = messages[0] || null;
  return {
    thread_id,
    subject: first?.subject || "(no subject)",
    from: first?.from || "",
    messages,
  };
}

// Build an RFC 2822 message body (no MIME multipart — plain text only), then
// base64url encode it for Gmail's `raw` field.
function buildRfc2822(input: { to: string; subject: string; body: string; in_reply_to?: string | null; references?: string | null; from?: string }) {
  const lines: string[] = [];
  if (input.from) lines.push(`From: ${input.from}`);
  lines.push(`To: ${input.to}`);
  lines.push(`Subject: ${input.subject}`);
  lines.push(`MIME-Version: 1.0`);
  lines.push(`Content-Type: text/plain; charset="UTF-8"`);
  lines.push(`Content-Transfer-Encoding: 7bit`);
  if (input.in_reply_to) lines.push(`In-Reply-To: ${input.in_reply_to}`);
  if (input.references) lines.push(`References: ${input.references}`);
  lines.push("");
  lines.push(input.body);
  return lines.join("\r\n");
}

export type CreateDraftInput = {
  to: string;
  subject: string;
  body: string;
  in_reply_to?: string | null;
  references?: string | null;
  thread_id?: string | null;
};

export async function createDraft(channel: AssistantChannelRow, input: CreateDraftInput): Promise<{ draft_id: string; message_id: string }> {
  noteCall(channel.id, 10);
  const raw = utf8ToB64url(buildRfc2822({
    to: input.to,
    subject: input.subject,
    body: input.body,
    in_reply_to: input.in_reply_to || null,
    references: input.references || input.in_reply_to || null,
    from: channel.account_ref,
  }));
  const payload: any = { message: { raw } };
  if (input.thread_id) payload.message.threadId = input.thread_id;
  const j = await gmailFetch(channel, `/users/me/drafts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { draft_id: j.id as string, message_id: j.message?.id as string };
}

export async function sendDraft(channel: AssistantChannelRow, draft_id: string): Promise<{ sent_id: string }> {
  // Two gates: settings.auto_send is the explicit switch for automatic sending;
  // settings.supervised_send is the Assistant Settings radio ("Supervised send")
  // that also unlocks send-from-UI. Either allows the send.
  const settings = (channel.settings || {}) as any;
  const canSend = !!settings.auto_send || !!settings.supervised_send;
  if (!canSend) {
    throw new Error("send blocked: this channel is Draft-only — flip to Supervised send in Assistant Settings before sending");
  }
  noteCall(channel.id, 20);
  const j = await gmailFetch(channel, `/users/me/drafts/send`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: draft_id }),
  });
  return { sent_id: j.id as string };
}

// Health probe used by /api/integrations/connect when the vendor is `gmail` —
// returns the operator's email address so the row displays it.
export async function testGmailAccessToken(access_token: string): Promise<{ ok: boolean; email?: string; error?: string }> {
  try {
    const r = await fetch(`${GMAIL_API}/users/me/profile`, { headers: { "authorization": "Bearer " + access_token } });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      return { ok: false, error: `gmail profile ${r.status}: ${t.slice(0, 200)}` };
    }
    const j: any = await r.json();
    return { ok: true, email: String(j.emailAddress || "") };
  } catch (e: any) {
    return { ok: false, error: e?.message || "gmail probe failed" };
  }
}

// ==========================================================================
// Attachments — used by the Files INBOX auto-ingest.
//
// listMessagesWithAttachments returns light message metadata for messages
// received within a window that have at least one attachment. downloadAttachment
// pulls the raw bytes for one part. We keep these read-only so ingest never
// mutates Gmail state.
// ==========================================================================

export type GmailAttachmentDescriptor = {
  message_id: string;
  attachment_id: string;
  filename: string;
  mime_type: string;
  size: number | null;
};

export type GmailMessageWithAttachments = {
  message_id: string;
  from: string;
  subject: string;
  received_at: string; // ISO
  attachments: GmailAttachmentDescriptor[];
};

// Walk a Gmail payload tree, collecting every part whose body carries an
// attachmentId (which is Gmail's convention for "this part is a binary
// attachment, fetch it separately").
function collectAttachmentParts(
  message_id: string,
  payload: any,
  out: GmailAttachmentDescriptor[],
) {
  if (!payload) return;
  const body = payload.body;
  const attId = body?.attachmentId;
  if (attId) {
    out.push({
      message_id,
      attachment_id: attId,
      filename: String(payload.filename || "attachment"),
      mime_type: String(payload.mimeType || "application/octet-stream"),
      size: typeof body?.size === "number" ? body.size : null,
    });
  }
  if (Array.isArray(payload.parts)) {
    for (const p of payload.parts) collectAttachmentParts(message_id, p, out);
  }
}

// List messages that landed in the mailbox within the given window and
// have at least one attachment. Uses Gmail's `has:attachment` query so we
// don't pull irrelevant chatter.
export async function listMessagesWithAttachments(
  channel: AssistantChannelRow,
  sinceMinutes: number,
): Promise<GmailMessageWithAttachments[]> {
  const minutes = Math.max(1, Math.round(sinceMinutes));
  const days = Math.max(1, Math.ceil(minutes / 60 / 24));
  // Gmail's `newer_than` only resolves to days, so we over-fetch and
  // filter on internalDate below.
  const q = encodeURIComponent(`newer_than:${days}d in:inbox has:attachment`);
  const list = await gmailFetch(
    channel,
    `/users/me/messages?q=${q}&maxResults=50`,
  );
  const messages: any[] = list.messages || [];
  const cutoff = Date.now() - minutes * 60_000;

  const out: GmailMessageWithAttachments[] = [];
  for (const m of messages) {
    try {
      const full = await gmailFetch(
        channel,
        `/users/me/messages/${m.id}?format=full`,
      );
      const internal = Number(full.internalDate || 0);
      if (internal && internal < cutoff) continue;
      const headers = full.payload?.headers || [];
      const from = findHeader(headers, "From");
      const subject = findHeader(headers, "Subject");
      const dateHdr = findHeader(headers, "Date");
      const iso = dateHdr
        ? new Date(dateHdr).toISOString()
        : new Date(internal || Date.now()).toISOString();
      const atts: GmailAttachmentDescriptor[] = [];
      collectAttachmentParts(m.id, full.payload, atts);
      if (!atts.length) continue;
      out.push({
        message_id: m.id,
        from,
        subject: subject || "(no subject)",
        received_at: iso,
        attachments: atts,
      });
    } catch (e: any) {
      console.warn(
        "[gmail] listMessagesWithAttachments message fetch failed",
        m.id,
        e?.message,
      );
    }
  }
  return out;
}

// Fetch the raw bytes for a single attachment. Returns a Uint8Array.
export async function downloadAttachment(
  channel: AssistantChannelRow,
  message_id: string,
  attachment_id: string,
): Promise<Uint8Array> {
  noteCall(channel.id, 5);
  const j = await gmailFetch(
    channel,
    `/users/me/messages/${encodeURIComponent(message_id)}/attachments/${encodeURIComponent(attachment_id)}`,
  );
  const dataStr = String(j.data || "");
  const norm = dataStr.replace(/-/g, "+").replace(/_/g, "/") +
    "==".slice((dataStr.length + 3) % 4);
  return new Uint8Array(Buffer.from(norm, "base64"));
}
