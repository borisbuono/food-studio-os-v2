// lib/email/pull.ts — Gmail → email_threads / email_messages. Server-only.
//
// Per account: first run = the last 7 days (newest first, capped per run so
// a Vercel invocation stays under its budget; the next poll continues);
// later runs = history.list since the stored historyId (404 → dated fallback).
// Idempotent on gmail_message_id. Attachments (PDF/images only, ≤ 15 MB) go to
// the private bucket email-attachments/<entity_id>/<thread>/<message>/<file>.
//
// This module READS Gmail and WRITES rows. It never sends, never labels — the
// classifier (E2) does labels, the edge function (E4) does sends.

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  GmailError, getAttachment, getMessage, getProfile, listHistory, listMessages, type MsgRef, type ParsedMessage,
} from "@/lib/email/gmail";
import { accessTokenFor, loadActiveAccounts, markAccountError, markAccountOk, type EmailAccount } from "@/lib/email/accounts";

export const FIRST_RUN_DAYS = 7;
export const MAX_MESSAGES_PER_RUN = 60;        // per account per poll
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const CAPTURE_MIMES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"]);
export const ATTACHMENT_BUCKET = "email-attachments";

export type PullCounts = { seen: number; inserted: number; threads_new: number; attachments: number; skipped_ours: number; errors: number; mode: "initial" | "history" };

function ourAddresses(account: EmailAccount, all: EmailAccount[]): Set<string> {
  // every connected mailbox of the same entity counts as "us" (info@ answering a mail cc'd to admin@)
  return new Set(all.filter((a) => a.entity_id === account.entity_id).map((a) => a.address.toLowerCase()).concat(account.address.toLowerCase()));
}

export async function pullAccount(svc: SupabaseClient, account: EmailAccount, all: EmailAccount[], via: string): Promise<PullCounts> {
  const counts: PullCounts = { seen: 0, inserted: 0, threads_new: 0, attachments: 0, skipped_ours: 0, errors: 0, mode: account.history_id ? "history" : "initial" };
  const token = await accessTokenFor(svc, account);
  const ours = ourAddresses(account, all);

  // 1) which messages?
  let refs: MsgRef[] = [];
  let newHistoryId: string | null = null;
  if (account.history_id) {
    try {
      let page: string | undefined;
      for (let i = 0; i < 5; i++) {
        const h = await listHistory(token, account.history_id, page);
        refs.push(...h.added);
        newHistoryId = h.historyId || newHistoryId;
        if (!h.nextPageToken) break;
        page = h.nextPageToken;
      }
    } catch (e) {
      if (e instanceof GmailError && (e.status === 404 || e.reason === "notFound")) {
        counts.mode = "initial";             // historyId too old → dated listing below
      } else throw e;
    }
  }
  if (counts.mode === "initial") {
    const l = await listMessages(token, { q: `newer_than:${FIRST_RUN_DAYS}d -in:chats -in:spam -in:trash`, maxResults: MAX_MESSAGES_PER_RUN });
    refs = l.messages;
    // The profile's historyId marks "now"; the next poll walks forward from here.
    try { newHistoryId = (await getProfile(token)).historyId || null; } catch { newHistoryId = null; }
  }
  // de-dup refs, cap per run, skip what we already hold
  const uniq = new Map<string, MsgRef>();
  for (const r of refs) uniq.set(r.id, r);
  let ids = Array.from(uniq.keys());
  counts.seen = ids.length;
  if (ids.length) {
    const { data: have } = await svc.from("email_messages").select("gmail_message_id").in("gmail_message_id", ids.slice(0, 1000));
    const haveSet = new Set((have || []).map((h: any) => h.gmail_message_id));
    ids = ids.filter((id) => !haveSet.has(id));
  }
  const capped = ids.slice(0, MAX_MESSAGES_PER_RUN);
  const leftover = ids.length > capped.length;

  // 2) fetch + store, oldest first so first_received_at is right
  const parsed: ParsedMessage[] = [];
  for (const id of capped) {
    try { parsed.push(await getMessage(token, id)); }
    catch (e) { counts.errors++; if (e instanceof GmailError && e.status === 404) continue; if (e instanceof GmailError && e.status === 401) throw e; }
  }
  parsed.sort((a, b) => Date.parse(a.date || "0") - Date.parse(b.date || "0"));

  for (const m of parsed) {
    if (m.labelIds.includes("DRAFT")) continue;
    const fromUs = !!m.from.address && ours.has(m.from.address);
    const direction: "in" | "out" = fromUs || m.labelIds.includes("SENT") ? "out" : "in";
    if (direction === "out") counts.skipped_ours++;   // stored (thread history), not drafted for

    // thread row
    const { data: t0 } = await svc.from("email_threads").select("id, first_received_at, last_received_at, message_count, participants, status, from_address")
      .eq("account_id", account.id).eq("gmail_thread_id", m.threadId).maybeSingle();
    let threadId: string;
    const parts = new Set<string>([...(t0?.participants || []), ...(m.from.address ? [m.from.address] : []), ...m.to, ...m.cc].filter((p) => !ours.has(p)));
    if (!t0) {
      const { data: tn, error } = await svc.from("email_threads").insert({
        entity_id: account.entity_id, account_id: account.id, gmail_thread_id: m.threadId,
        subject: m.subject, snippet: m.snippet,
        from_address: direction === "in" ? m.from.address : (m.to[0] || null), from_name: direction === "in" ? m.from.name : null,
        participants: Array.from(parts),
        first_received_at: direction === "in" ? m.date : null, last_received_at: direction === "in" ? m.date : null,
        message_count: 0, labels: m.labelIds,
        // a thread whose only message is ours (we wrote first) has nothing to answer
        status: direction === "in" ? "new" : "archived",
      }).select("id").single();
      if (error || !tn) { counts.errors++; continue; }
      threadId = (tn as any).id; counts.threads_new++;
    } else {
      threadId = (t0 as any).id;
    }

    // message row (idempotent on gmail_message_id)
    const { data: mi, error: me } = await svc.from("email_messages").upsert({
      thread_id: threadId, entity_id: account.entity_id, account_id: account.id, gmail_message_id: m.id, direction,
      from_address: m.from.address, from_name: m.from.name, to_addresses: m.to, cc_addresses: m.cc,
      subject: m.subject, snippet: m.snippet, body_text: m.body_text, received_at: m.date, labels: m.labelIds,
      message_id_header: m.message_id_header, in_reply_to: m.in_reply_to, references_header: m.references,
      attachments: m.attachments.map((a) => ({ filename: a.filename, mime: a.mime, size: a.size, attachment_id: a.attachment_id })),
    }, { onConflict: "gmail_message_id", ignoreDuplicates: true }).select("id").maybeSingle();
    if (me) { counts.errors++; continue; }
    if (!mi) continue;                 // already there
    counts.inserted++;
    const messageRowId = (mi as any).id as string;

    // attachments → private bucket (only what the capture funnel can read)
    const stored: any[] = [];
    for (const a of m.attachments) {
      const entry: any = { filename: a.filename, mime: a.mime, size: a.size, attachment_id: a.attachment_id };
      if (CAPTURE_MIMES.has(a.mime) && a.size > 0 && a.size <= MAX_ATTACHMENT_BYTES) {
        try {
          const buf = await getAttachment(token, m.id, a.attachment_id);
          const sha = createHash("sha256").update(buf).digest("hex");
          const safe = a.filename.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80) || "file";
          const path = `${account.entity_id}/${m.threadId}/${m.id}/${sha.slice(0, 8)}-${safe}`;
          const up = await svc.storage.from(ATTACHMENT_BUCKET).upload(path, buf, { contentType: a.mime, upsert: true });
          if (!up.error) { entry.storage_path = path; entry.sha256 = sha; counts.attachments++; }
          else entry.error = up.error.message;
        } catch (e: any) { entry.error = String(e?.message || e).slice(0, 200); }
      }
      stored.push(entry);
    }
    if (stored.length) await svc.from("email_messages").update({ attachments: stored }).eq("id", messageRowId);

    // thread bookkeeping
    const patch: Record<string, unknown> = {
      participants: Array.from(parts), message_count: Number(t0?.message_count || 0) + 1, labels: m.labelIds,
      subject: t0 ? undefined : m.subject,
    };
    if (direction === "in") {
      patch.last_received_at = m.date; patch.last_message_id = messageRowId; patch.snippet = m.snippet;
      if (!t0?.first_received_at) patch.first_received_at = m.date;
      if (!t0?.from_address) { patch.from_address = m.from.address; patch.from_name = m.from.name; }
      // a new inbound message on a thread we had answered / archived re-opens it
      if (t0 && ["replied", "archived", "skipped"].includes(String(t0.status))) patch.status = "new";
    }
    for (const k of Object.keys(patch)) if (patch[k] === undefined) delete patch[k];
    await svc.from("email_threads").update(patch).eq("id", threadId);
  }

  // Only advance the cursor when we drained the list; otherwise the next poll
  // re-lists and the dedup above skips what we hold.
  await markAccountOk(svc, account, leftover ? null : newHistoryId);
  await svc.from("email_pulls").insert({ account_id: account.id, via, ok: true, counts: { ...counts, leftover } });
  return counts;
}

export async function pullAll(svc: SupabaseClient, via: string, opts: { accountId?: string | null; entityId?: string | null } = {}): Promise<Array<{ account: string; ok: boolean; counts?: PullCounts; error?: string }>> {
  const accounts = await loadActiveAccounts(svc, opts.accountId, opts.entityId);
  const out: Array<{ account: string; ok: boolean; counts?: PullCounts; error?: string }> = [];
  for (const a of accounts) {
    if (a.status === "needs_reconnect") { out.push({ account: a.address, ok: false, error: "needs_reconnect" }); continue; }
    try {
      const counts = await pullAccount(svc, a, accounts, via);
      out.push({ account: a.address, ok: true, counts });
    } catch (e: any) {
      const msg = String(e?.message || e);
      await markAccountError(svc, a, e);
      await svc.from("email_pulls").insert({ account_id: a.id, via, ok: false, error: msg.slice(0, 400) });
      out.push({ account: a.address, ok: false, error: msg });
    }
  }
  return out;
}
