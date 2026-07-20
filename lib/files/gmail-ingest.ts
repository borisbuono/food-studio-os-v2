// Files INBOX — Gmail auto-ingest.
//
// Sweeps the two admin@ mailboxes (BM + IFL) and copies every attachment
// received in the last N minutes into the `documents-inbox` storage bucket +
// inserts a files_inbox row per attachment. Read-only against Gmail: we
// never label, archive, or reply.
//
// Dedup contract: (source, source_ref) is the natural key — a Gmail message
// with 3 attachments produces 3 inbox rows sharing the same source_ref but
// distinguished by filename inside `payload`. If the sweep re-runs we skip
// (message_id, filename) pairs that already exist.
//
// The cron entrypoint (/api/cron/files-inbox) drives this every 15 min.

import { supabaseServer } from "@/lib/supabaseServer";
import {
  listMessagesWithAttachments,
  downloadAttachment,
  type GmailMessageWithAttachments,
} from "@/lib/assistant/channels/gmail";
import type { AssistantChannelRow } from "@/types/db";

export type AdminMailbox =
  | "admin@bistro-mondo.com"
  | "admin@ibzfoodstudio.com";

// Map mailbox → files_inbox.source enum.
const MAILBOX_SOURCE: Record<AdminMailbox, string> = {
  "admin@bistro-mondo.com": "gmail_admin_bm",
  "admin@ibzfoodstudio.com": "gmail_admin_ifl",
};

// Map mailbox → entity code (used before the classifier runs so the row is
// at least visible to the right operator).
const MAILBOX_ENTITY: Record<AdminMailbox, "BM" | "IFL"> = {
  "admin@bistro-mondo.com": "BM",
  "admin@ibzfoodstudio.com": "IFL",
};

// Attachment MIME allow-list. Everything else is skipped (we don't want to
// ingest inline signature GIFs or the mailer's own tracking pixels).
const ACCEPT_MIME = new Set<string>([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "text/csv",
  "text/plain",
]);

// Attachments smaller than this are almost always signature glyphs / footer
// logos. Ignore them so triage isn't drowned in noise.
const MIN_BYTES = 4_000;

function sanitiseFilename(s: string): string {
  return (s || "attachment")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100) || "attachment";
}

function extFromFilename(name: string, mime: string): string {
  const m = name.match(/\.([a-z0-9]{1,6})$/i);
  if (m) return m[1].toLowerCase();
  if (mime.includes("pdf")) return "pdf";
  if (mime.includes("jpeg")) return "jpg";
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  return "bin";
}

// Find the Gmail channel serving a given operator email address. The auth
// row's account_ref is the email address — same shape used by the payment
// scanner elsewhere in lib/finance.
async function findGmailChannelForMailbox(
  mailbox: AdminMailbox,
): Promise<AssistantChannelRow | null> {
  const sb = supabaseServer();
  const { data } = await sb.from("assistant_channels")
    .select("id,user_id,channel_type,account_ref,auth_ref,settings,created_at,revoked_at")
    .eq("channel_type", "gmail")
    .eq("account_ref", mailbox)
    .is("revoked_at", null)
    .maybeSingle();
  return (data as AssistantChannelRow | null) || null;
}

// Return the set of (source_ref, filename) pairs already ingested — used
// to avoid duplicate rows when the cron sweeps back over overlap.
async function existingKeys(
  source: string,
  messageIds: string[],
): Promise<Set<string>> {
  const out = new Set<string>();
  if (!messageIds.length) return out;
  const sb = supabaseServer();
  const { data } = await sb.from("files_inbox")
    .select("source_ref,file_url")
    .eq("source", source)
    .in("source_ref", messageIds);
  for (const r of (data as any[] | null) || []) {
    // file_url ends with `<inbox_id>_<sanitised-filename>` — we only need
    // to check message_id + filename to spot dupes, so pull the suffix.
    const fname = String(r.file_url || "").split("/").pop() || "";
    // drop the leading `<inbox_id>_`
    const bare = fname.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_/, "");
    out.add(`${r.source_ref}::${bare}`);
  }
  return out;
}

export type IngestSummary = {
  mailbox: AdminMailbox;
  ok: boolean;
  reason?: string;
  messages_seen: number;
  rows_created: number;
  rows_skipped_duplicate: number;
  rows_skipped_mime: number;
  rows_skipped_size: number;
  created_ids: string[];
};

// Main entry — sweep the mailbox, insert one files_inbox row per new
// attachment. Does NOT trigger classification; the caller (cron or API
// route) drives that separately so the ingest sweep can complete
// even if the classifier is misconfigured.
export async function ingestForMailbox(
  mailbox: AdminMailbox,
  sinceMinutes: number,
): Promise<IngestSummary> {
  const summary: IngestSummary = {
    mailbox,
    ok: false,
    messages_seen: 0,
    rows_created: 0,
    rows_skipped_duplicate: 0,
    rows_skipped_mime: 0,
    rows_skipped_size: 0,
    created_ids: [],
  };

  const channel = await findGmailChannelForMailbox(mailbox);
  if (!channel) {
    summary.reason = `No connected Gmail channel for ${mailbox}. Connect it in Assistant Settings first.`;
    return summary;
  }

  let messages: GmailMessageWithAttachments[] = [];
  try {
    messages = await listMessagesWithAttachments(channel, sinceMinutes);
  } catch (e: any) {
    summary.reason = "Gmail list failed: " + (e?.message || String(e));
    return summary;
  }
  summary.messages_seen = messages.length;
  const source = MAILBOX_SOURCE[mailbox];
  const entity = MAILBOX_ENTITY[mailbox];

  const messageIds = messages.map((m) => m.message_id);
  const seenKeys = await existingKeys(source, messageIds);

  const sb = supabaseServer();
  for (const msg of messages) {
    for (const att of msg.attachments) {
      const mime = att.mime_type.toLowerCase();
      if (!ACCEPT_MIME.has(mime) && !mime.startsWith("image/")) {
        summary.rows_skipped_mime++;
        continue;
      }
      const size = att.size || 0;
      if (size && size < MIN_BYTES) {
        summary.rows_skipped_size++;
        continue;
      }
      const bareName = sanitiseFilename(att.filename);
      const dedupKey = `${msg.message_id}::${bareName}`;
      if (seenKeys.has(dedupKey)) {
        summary.rows_skipped_duplicate++;
        continue;
      }

      // Download bytes.
      let bytes: Uint8Array;
      try {
        bytes = await downloadAttachment(channel, msg.message_id, att.attachment_id);
      } catch (e: any) {
        console.warn("[files-inbox] attachment download failed", msg.message_id, att.filename, e?.message);
        continue;
      }
      if (bytes.byteLength < MIN_BYTES) {
        summary.rows_skipped_size++;
        continue;
      }

      // Upload to storage. Path convention:
      //   documents-inbox/<yyyy-mm-dd>/<uuid>_<sanitised-filename>.<ext>
      // We pre-generate the row id so the object path carries it.
      const rowId = crypto.randomUUID();
      const day = msg.received_at.slice(0, 10);
      const ext = extFromFilename(bareName, mime);
      const finalName = bareName.match(/\.[a-z0-9]{1,6}$/i) ? bareName : `${bareName}.${ext}`;
      const key = `${day}/${rowId}_${finalName}`;
      const bucket = "documents-inbox";
      const { error: upErr } = await sb.storage.from(bucket)
        .upload(key, bytes, { contentType: mime, upsert: false });
      if (upErr) {
        console.warn("[files-inbox] storage upload failed", key, upErr.message);
        continue;
      }

      const filePath = `${bucket}/${key}`;
      const { error: insErr } = await sb.from("files_inbox").insert({
        id: rowId,
        source,
        source_ref: msg.message_id,
        sender: msg.from,
        subject: msg.subject,
        received_at: msg.received_at,
        file_url: filePath,
        file_bytes: bytes.byteLength,
        mime_type: mime,
        // Store a coarse pre-classification hint so the row is visible to the
        // right entity even if the classifier is off.
        suggested_entity: entity,
        status: "pending_classify",
      });
      if (insErr) {
        console.warn("[files-inbox] row insert failed", rowId, insErr.message);
        // Clean up the orphaned storage object so retries can succeed.
        await sb.storage.from(bucket).remove([key]);
        continue;
      }
      summary.rows_created++;
      summary.created_ids.push(rowId);
    }
  }
  summary.ok = true;

  // Audit.
  await sb.from("assistant_actions").insert({
    user_id: null,
    action_kind: "files_inbox_ingest",
    action_type: "files.inbox.ingest_gmail",
    entity_code: entity,
    target_table: "files_inbox",
    payload: {
      mailbox,
      messages_seen: summary.messages_seen,
      rows_created: summary.rows_created,
      rows_skipped_duplicate: summary.rows_skipped_duplicate,
      rows_skipped_mime: summary.rows_skipped_mime,
      rows_skipped_size: summary.rows_skipped_size,
      since_minutes: sinceMinutes,
    },
    reversible: false,
  });

  return summary;
}
