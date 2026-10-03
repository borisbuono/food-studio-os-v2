// lib/email/gmail.ts — the ONE place the OS speaks to the Gmail REST API
// (Vercel side). Pure HTTP; no googleapis SDK. Server-only.
//
//   refreshAccessToken   refresh_token → access_token (client creds from env)
//   listMessages          q / labelIds, paginated
//   listHistory           history.list since historyId (incremental pull)
//   getMessage            full message, parsed into a flat shape
//   getAttachment         bytes of one attachment part
//   ensureLabel           find-or-create a user label by name ("OS/Captured")
//   modifyMessage         add / remove labels (archive = remove INBOX)
//   sendRaw               ONLY called from the edge function path (E4) — kept
//                         here so the MIME builder is tested once.
//
// Scopes the connect flow asks for (brief): gmail.readonly, gmail.send,
// gmail.modify (labels). openid+email so the callback knows which mailbox.

export const GMAIL_SCOPES = [
  "openid", "email",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
];
const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export function emailRedirectUri(origin: string) {
  return `${origin}/api/email/callback`;
}

export function scrubToken(s: string): string {
  return s.replace(/ya29\.[A-Za-z0-9_-]{20,}/g, "[token]").replace(/1\/\/[A-Za-z0-9_-]{20,}/g, "[refresh]");
}

export class GmailError extends Error {
  status: number; reason: string | null;
  constructor(status: number, message: string, reason: string | null = null) { super(scrubToken(message)); this.status = status; this.reason = reason; }
}

export async function refreshAccessToken(refresh_token: string): Promise<{ access_token: string; expires_at: string; scope: string | null }> {
  const id = process.env.GOOGLE_OAUTH_CLIENT_ID, secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!id || !secret) throw new GmailError(500, "GOOGLE_OAUTH_CLIENT_ID / _SECRET not configured");
  const r = await fetch(TOKEN_URL, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token, grant_type: "refresh_token" }),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    // invalid_grant = the user revoked us or the refresh token expired → needs_reconnect
    throw new GmailError(r.status || 502, `google refresh ${r.status}: ${j.error || "no token"}${j.error_description ? " — " + j.error_description : ""}`, j.error || null);
  }
  return { access_token: String(j.access_token), expires_at: new Date(Date.now() + (Number(j.expires_in) || 3000) * 1000).toISOString(), scope: j.scope || null };
}

async function g(token: string, path: string, init: RequestInit = {}): Promise<any> {
  const r = await fetch(path.startsWith("http") ? path : `${API}${path}`, {
    ...init, headers: { authorization: `Bearer ${token}`, accept: "application/json", ...(init.headers || {}) },
  });
  const text = await r.text();
  let j: any = null; try { j = text ? JSON.parse(text) : null; } catch { /* not json */ }
  if (!r.ok) {
    const reason = j?.error?.errors?.[0]?.reason || j?.error?.status || null;
    throw new GmailError(r.status, `gmail ${r.status} on ${path.split("?")[0]}: ${j?.error?.message || text.slice(0, 200)}`, reason);
  }
  return j;
}

// ---------------------------------------------------------------- listing
export type MsgRef = { id: string; threadId: string };

export async function listMessages(token: string, opts: { q?: string; labelIds?: string[]; maxResults?: number; pageToken?: string }): Promise<{ messages: MsgRef[]; nextPageToken: string | null; resultSizeEstimate: number }> {
  const u = new URLSearchParams();
  if (opts.q) u.set("q", opts.q);
  for (const l of opts.labelIds || []) u.append("labelIds", l);
  u.set("maxResults", String(opts.maxResults || 50));
  if (opts.pageToken) u.set("pageToken", opts.pageToken);
  const j = await g(token, `/messages?${u}`);
  return { messages: (j?.messages || []) as MsgRef[], nextPageToken: j?.nextPageToken || null, resultSizeEstimate: Number(j?.resultSizeEstimate || 0) };
}

export async function getProfile(token: string): Promise<{ emailAddress: string; historyId: string; messagesTotal: number }> {
  const j = await g(token, `/profile`);
  return { emailAddress: String(j.emailAddress || ""), historyId: String(j.historyId || ""), messagesTotal: Number(j.messagesTotal || 0) };
}

// history.list: everything added since startHistoryId. 404 = historyId too
// old → caller falls back to a dated listMessages.
export async function listHistory(token: string, startHistoryId: string, pageToken?: string): Promise<{ added: MsgRef[]; labelsChanged: Array<{ id: string; threadId: string; added: string[]; removed: string[] }>; historyId: string | null; nextPageToken: string | null }> {
  const u = new URLSearchParams({ startHistoryId, maxResults: "200" });
  u.append("historyTypes", "messageAdded"); u.append("historyTypes", "labelAdded"); u.append("historyTypes", "labelRemoved");
  if (pageToken) u.set("pageToken", pageToken);
  const j = await g(token, `/history?${u}`);
  const added: MsgRef[] = []; const labelsChanged: Array<{ id: string; threadId: string; added: string[]; removed: string[] }> = [];
  for (const h of j?.history || []) {
    for (const m of h.messagesAdded || []) if (m.message?.id) added.push({ id: m.message.id, threadId: m.message.threadId });
    for (const m of h.labelsAdded || []) if (m.message?.id) labelsChanged.push({ id: m.message.id, threadId: m.message.threadId, added: m.labelIds || [], removed: [] });
    for (const m of h.labelsRemoved || []) if (m.message?.id) labelsChanged.push({ id: m.message.id, threadId: m.message.threadId, added: [], removed: m.labelIds || [] });
  }
  return { added, labelsChanged, historyId: j?.historyId ? String(j.historyId) : null, nextPageToken: j?.nextPageToken || null };
}

// ---------------------------------------------------------------- one message, flattened
export type ParsedAttachment = { filename: string; mime: string; size: number; attachment_id: string; part_id: string };
export type ParsedMessage = {
  id: string; threadId: string; historyId: string | null; labelIds: string[];
  from: { address: string | null; name: string | null };
  to: string[]; cc: string[];
  subject: string | null; snippet: string | null; date: string | null;
  message_id_header: string | null; in_reply_to: string | null; references: string | null;
  list_unsubscribe: string | null; precedence: string | null; auto_submitted: string | null;
  body_text: string | null;
  attachments: ParsedAttachment[];
};

const b64url = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
export function parseAddress(v: string | null | undefined): { address: string | null; name: string | null } {
  const s = String(v || "").trim();
  if (!s) return { address: null, name: null };
  const m = s.match(/^\s*(?:"?([^"<]*)"?\s*)?<([^>]+)>\s*$/);
  if (m) return { address: m[2].trim().toLowerCase(), name: (m[1] || "").trim() || null };
  const bare = s.match(/[^\s<>,;]+@[^\s<>,;]+/);
  return { address: bare ? bare[0].toLowerCase() : null, name: null };
}
export function parseAddressList(v: string | null | undefined): string[] {
  return String(v || "").split(",").map((x) => parseAddress(x).address).filter((x): x is string => !!x);
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
}

function walkParts(part: any, out: { text: string[]; html: string[]; atts: ParsedAttachment[] }) {
  if (!part) return;
  const mime = String(part.mimeType || "");
  const body = part.body || {};
  const filename = String(part.filename || "");
  if (filename && body.attachmentId) {
    out.atts.push({ filename, mime, size: Number(body.size || 0), attachment_id: String(body.attachmentId), part_id: String(part.partId || "") });
  } else if (mime === "text/plain" && body.data) {
    out.text.push(b64url(body.data).toString("utf8"));
  } else if (mime === "text/html" && body.data) {
    out.html.push(b64url(body.data).toString("utf8"));
  }
  for (const p of part.parts || []) walkParts(p, out);
}

export async function getMessage(token: string, id: string): Promise<ParsedMessage> {
  const j = await g(token, `/messages/${encodeURIComponent(id)}?format=full`);
  const headers: Record<string, string> = {};
  for (const h of j?.payload?.headers || []) headers[String(h.name || "").toLowerCase()] = String(h.value || "");
  const acc = { text: [] as string[], html: [] as string[], atts: [] as ParsedAttachment[] };
  walkParts(j?.payload, acc);
  const text = acc.text.join("\n").trim() || (acc.html.length ? htmlToText(acc.html.join("\n")) : "");
  const dateMs = j?.internalDate ? Number(j.internalDate) : NaN;
  return {
    id: String(j.id), threadId: String(j.threadId), historyId: j.historyId ? String(j.historyId) : null, labelIds: (j.labelIds || []) as string[],
    from: parseAddress(headers["from"]), to: parseAddressList(headers["to"]), cc: parseAddressList(headers["cc"]),
    subject: headers["subject"] || null, snippet: j.snippet ? String(j.snippet) : null,
    date: Number.isFinite(dateMs) ? new Date(dateMs).toISOString() : (headers["date"] ? new Date(headers["date"]).toISOString() : null),
    message_id_header: headers["message-id"] || null, in_reply_to: headers["in-reply-to"] || null, references: headers["references"] || null,
    list_unsubscribe: headers["list-unsubscribe"] || null, precedence: headers["precedence"] || null, auto_submitted: headers["auto-submitted"] || null,
    body_text: text ? text.slice(0, 20000) : null,
    attachments: acc.atts,
  };
}

export async function getAttachment(token: string, messageId: string, attachmentId: string): Promise<Buffer> {
  const j = await g(token, `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`);
  return b64url(String(j?.data || ""));
}

// ---------------------------------------------------------------- labels
const labelCache = new Map<string, Map<string, string>>(); // token → name → id (per invocation)
export async function ensureLabel(token: string, name: string): Promise<string> {
  let cache = labelCache.get(token);
  if (!cache) {
    const j = await g(token, `/labels`);
    cache = new Map<string, string>((j?.labels || []).map((l: any) => [String(l.name), String(l.id)]));
    labelCache.set(token, cache);
  }
  const have = cache.get(name);
  if (have) return have;
  const created = await g(token, `/labels`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, labelListVisibility: "labelShow", messageListVisibility: "show" }),
  });
  cache.set(name, String(created.id));
  return String(created.id);
}

export async function modifyMessage(token: string, id: string, add: string[], remove: string[]): Promise<void> {
  await g(token, `/messages/${encodeURIComponent(id)}/modify`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ addLabelIds: add, removeLabelIds: remove }),
  });
}

export async function modifyThread(token: string, threadId: string, add: string[], remove: string[]): Promise<void> {
  await g(token, `/threads/${encodeURIComponent(threadId)}/modify`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ addLabelIds: add, removeLabelIds: remove }),
  });
}

// ---------------------------------------------------------------- MIME for a reply (used by the edge function too; kept identical)
export function encodeHeaderWord(s: string): string {
  return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;
}
export function buildReplyMime(a: { from: string; to: string[]; cc?: string[]; subject: string; text: string; inReplyTo?: string | null; references?: string | null }): string {
  const subj = a.subject.trim().toLowerCase().startsWith("re:") ? a.subject.trim() : `Re: ${a.subject.trim()}`;
  const lines = [
    `From: ${a.from}`,
    `To: ${a.to.join(", ")}`,
    ...(a.cc && a.cc.length ? [`Cc: ${a.cc.join(", ")}`] : []),
    `Subject: ${encodeHeaderWord(subj)}`,
    ...(a.inReplyTo ? [`In-Reply-To: ${a.inReplyTo}`] : []),
    ...(a.references ? [`References: ${a.references}`] : []),
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset="UTF-8"`,
    `Content-Transfer-Encoding: base64`,
    ``,
    Buffer.from(a.text, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n"),
  ];
  return lines.join("\r\n");
}
export function toBase64Url(s: string): string {
  return Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
