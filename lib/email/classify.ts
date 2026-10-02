// lib/email/classify.ts — E2: sort what came in, then route it. Server-only.
//
//   rules first  (sender domain / headers / attachment + keyword — no model call)
//   Haiku second (same model path as inboxDraft; JSON out; confidence is a field)
//
// Categories (brief):
//   enquiry          sales / booking / event / private chef   → card (E3 drafts)
//   supplier_doc     factura / albarán / extracto             → capture funnel, label OS/Captured, archived
//   fiscal_legal     AEAT, TGSS, lawyer, landlord, bank       → flagged, NO draft, register needs_you with deadline
//   booking_change   Fresto / guest changes a booking         → card (E3 drafts)
//   newsletter_noise                                         → label OS/Noise, archived, never shown
//   other                                                    → card, no draft
//
// Nothing here sends. Labels/archive go through gmail.modify on the connected
// mailbox; the capture push to Holded is NOT triggered here (human tick in
// Finance → Scans, FS_HOLDED_DRY_RUN still gates it).

import type { SupabaseClient } from "@supabase/supabase-js";
import { callClaude, INBOX_MODEL } from "@/lib/social/inboxDraft";
import { accessTokenFor, loadAccount, type EmailAccount } from "@/lib/email/accounts";
import { ensureLabel, modifyThread, GmailError } from "@/lib/email/gmail";
import { ATTACHMENT_BUCKET } from "@/lib/email/pull";
import { registerNeedsYou } from "@/lib/email/register";
import { ingestCapture } from "@/lib/capture/ingest";
import { findInHolded, workingHoldedKey } from "@/lib/capture/holded";
import type { EntityCode } from "@/lib/capture/pure";
import { observe } from "@/lib/observations";
import { CATEGORIES, type Category, type ClassifyInput, type Verdict, type EnquiryFields, ruleClassify, CAPTURE_MIMES, SLUG_CODE, LABEL_CAPTURED, LABEL_NOISE, LABEL_NEEDS_YOU, domainOf } from "@/lib/email/rules";
export { CATEGORIES, ruleClassify, type Category, type ClassifyInput, type Verdict, type EnquiryFields } from "@/lib/email/rules";

// ---------------------------------------------------------------- the model
function stripJson(txt: string): any | null {
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}
const SYSTEM = `You sort incoming email for a small restaurant group in Ibiza (Bistro Mondo, Ibiza Food Studio / Taller). Reply with JSON only.

Categories:
- "enquiry": someone wants to book an event, a private dinner, a private chef, a cooking class, catering, a group, or asks for prices/availability for any of these.
- "booking_change": an existing restaurant booking is being made, moved or cancelled (a guest or a booking platform).
- "supplier_doc": a supplier sends an invoice, delivery note, statement or receipt (usually as an attachment).
- "fiscal_legal": tax office (AEAT, Hacienda), Social Security (TGSS), a lawyer, a court, the town hall, the landlord, a bank about debt/compliance, a fine, an official notification. Anything with a legal deadline.
- "newsletter_noise": newsletters, marketing, automated notifications nobody needs to answer, cold sales pitches from software vendors.
- "other": everything else (a question that needs a human, a partnership, press, a job application, a personal mail).

Also extract, when the category is "enquiry":
  enquiry_fields = { "date": "YYYY-MM-DD" or null, "pax": integer or null, "budget_pp": number in EUR per person or null, "venue_case": "provider" (they have a venue) | "ours" (at our restaurant) | "help" (they need a venue) | null, "food_shape": "set" | "sharing" | "buffet" | "canapes" | null, "language": ISO 639-1 of the sender }
When the category is "fiscal_legal": needs_you_due = the deadline as "YYYY-MM-DD" if one is stated or can be computed from a stated period (e.g. "10 días hábiles" from the mail date), else null.
Never invent: null when not in the text. confidence is 0..1 for the category.

Output: {"category": "...", "confidence": 0.0, "language": "es", "reason": "<one short line>", "enquiry_fields": {...} or null, "needs_you_due": "YYYY-MM-DD" or null}`;

export async function modelClassify(x: ClassifyInput, received_at: string | null): Promise<Verdict> {
  const user = [
    `Received: ${received_at || "unknown"}`,
    `From: ${x.from_name ? `${x.from_name} <${x.from_address || ""}>` : x.from_address || "unknown"}`,
    `Subject: ${x.subject || "(none)"}`,
    x.attachments.length ? `Attachments: ${x.attachments.map((a) => `${a.filename} (${a.mime})`).join(", ")}` : `Attachments: none`,
    ``,
    (x.body || "").slice(0, 6000) || "(empty body)",
  ].join("\n");
  const txt = await callClaude(SYSTEM, user, 500);
  const j = stripJson(txt);
  if (!j || !CATEGORIES.includes(j.category)) return { category: "other", confidence: 0.3, by: INBOX_MODEL, reason: "model returned no usable JSON" };
  const ef = j.enquiry_fields && typeof j.enquiry_fields === "object" ? {
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(j.enquiry_fields.date || "")) ? String(j.enquiry_fields.date) : null,
    pax: Number.isFinite(Number(j.enquiry_fields.pax)) && Number(j.enquiry_fields.pax) > 0 ? Math.round(Number(j.enquiry_fields.pax)) : null,
    budget_pp: Number.isFinite(Number(j.enquiry_fields.budget_pp)) && Number(j.enquiry_fields.budget_pp) > 0 ? Number(j.enquiry_fields.budget_pp) : null,
    venue_case: ["provider", "ours", "help"].includes(j.enquiry_fields.venue_case) ? j.enquiry_fields.venue_case : null,
    food_shape: ["set", "sharing", "buffet", "canapes"].includes(j.enquiry_fields.food_shape) ? j.enquiry_fields.food_shape : null,
    language: typeof j.enquiry_fields.language === "string" ? j.enquiry_fields.language.slice(0, 5).toLowerCase() : (typeof j.language === "string" ? j.language.slice(0, 5).toLowerCase() : null),
  } as EnquiryFields : null;
  return {
    category: j.category as Category,
    confidence: Math.max(0, Math.min(1, Number(j.confidence) || 0.5)),
    by: INBOX_MODEL,
    enquiry_fields: j.category === "enquiry" ? ef : null,
    needs_you_due: /^\d{4}-\d{2}-\d{2}$/.test(String(j.needs_you_due || "")) ? String(j.needs_you_due) : null,
    reason: typeof j.reason === "string" ? j.reason.slice(0, 200) : null,
    language: typeof j.language === "string" ? j.language.slice(0, 5).toLowerCase() : null,
  };
}

// ---------------------------------------------------------------- classify one thread
type ThreadRow = {
  id: string; entity_id: string; account_id: string; gmail_thread_id: string; subject: string | null; status: string;
  from_address: string | null; from_name: string | null; last_message_id: string | null; first_received_at: string | null; category: Category | null;
};
type MessageRow = {
  id: string; gmail_message_id: string; direction: "in" | "out"; from_address: string | null; from_name: string | null; subject: string | null;
  body_text: string | null; received_at: string | null; attachments: any[]; labels: string[];
  headers: { list_unsubscribe?: string | null; precedence?: string | null; auto_submitted?: string | null } | null;
};

async function latestInbound(svc: SupabaseClient, threadId: string): Promise<MessageRow | null> {
  const { data } = await svc.from("email_messages").select("id, gmail_message_id, direction, from_address, from_name, subject, body_text, received_at, attachments, labels, headers")
    .eq("thread_id", threadId).eq("direction", "in").order("received_at", { ascending: false }).limit(1).maybeSingle();
  return (data as MessageRow | null) || null;
}

export type ClassifyResult = { ok: boolean; id: string; category?: Category; confidence?: number; by?: string; routed?: string; error?: string };

export async function classifyThread(svc: SupabaseClient, threadId: string, opts: { force?: boolean } = {}): Promise<ClassifyResult> {
  const { data: t } = await svc.from("email_threads").select("id, entity_id, account_id, gmail_thread_id, subject, status, from_address, from_name, last_message_id, first_received_at, category").eq("id", threadId).maybeSingle();
  const thread = t as ThreadRow | null;
  if (!thread) return { ok: false, id: threadId, error: "not_found" };
  if (thread.status !== "new" && !opts.force) return { ok: false, id: threadId, error: `status ${thread.status}, not classifying` };
  const msg = await latestInbound(svc, threadId);
  if (!msg) return { ok: false, id: threadId, error: "no inbound message yet" };   // the pull flips status after the message lands; sweep retries
  const h = msg.headers || {};
  const input: ClassifyInput = {
    from_address: msg.from_address, from_name: msg.from_name, subject: msg.subject || thread.subject, body: msg.body_text,
    list_unsubscribe: h.list_unsubscribe || null, precedence: h.precedence || null, auto_submitted: h.auto_submitted || null,
    attachments: (msg.attachments || []).map((a: any) => ({ filename: String(a.filename || ""), mime: String(a.mime || "") })),
    direction: msg.direction,
  };
  let v: Verdict | null = null;
  try {
    v = ruleClassify(input);
    if (!v || v.confidence < 0.8) {
      const m = await modelClassify(input, msg.received_at);
      // a confident rule beats a hesitant model; otherwise the model (it also extracts)
      v = v && v.confidence >= m.confidence ? { ...v, enquiry_fields: m.enquiry_fields, needs_you_due: m.needs_you_due, language: m.language } : m;
    }
  } catch (e: any) {
    const err = `classify: ${String(e?.message || e).slice(0, 300)}`;
    await svc.from("email_threads").update({ error: err }).eq("id", threadId);
    return { ok: false, id: threadId, error: err };
  }
  const now = new Date().toISOString();
  await svc.from("email_threads").update({
    category: v.category, confidence: v.confidence, classified_by: v.by, classified_at: now,
    enquiry_fields: v.enquiry_fields || null, needs_you_due: v.needs_you_due || null, error: null,
  }).eq("id", threadId);

  let routed = "card";
  try { routed = await routeThread(svc, thread, msg, v); }
  catch (e: any) {
    const err = `route: ${String(e?.message || e).slice(0, 300)}`;
    await svc.from("email_threads").update({ status: "classified", error: err }).eq("id", threadId);
    return { ok: true, id: threadId, category: v.category, confidence: v.confidence, by: v.by, routed: "card (route failed)", error: err };
  }
  return { ok: true, id: threadId, category: v.category, confidence: v.confidence, by: v.by, routed };
}

// ---------------------------------------------------------------- route
async function label(svc: SupabaseClient, account: EmailAccount, gmailThreadId: string, add: string[], archive: boolean): Promise<string | null> {
  try {
    const token = await accessTokenFor(svc, account);
    const ids: string[] = [];
    for (const n of add) ids.push(await ensureLabel(token, n));
    await modifyThread(token, gmailThreadId, ids, archive ? ["INBOX"] : []);
    return null;
  } catch (e: any) {
    return e instanceof GmailError ? e.message : String(e?.message || e);
  }
}

async function routeThread(svc: SupabaseClient, thread: ThreadRow, msg: MessageRow, v: Verdict): Promise<string> {
  const account = await loadAccount(svc, thread.account_id);
  if (!account) throw new Error("account not found");
  const { data: ent } = await svc.from("entities").select("slug, name").eq("id", thread.entity_id).maybeSingle();
  const slug = String((ent as any)?.slug || "");
  const code: EntityCode | null = SLUG_CODE[slug] || null;

  switch (v.category) {
    case "newsletter_noise": {
      const err = await label(svc, account, thread.gmail_thread_id, [LABEL_NOISE], true);
      await svc.from("email_threads").update({ status: "noise", error: err }).eq("id", thread.id);
      return err ? "noise (label failed)" : "noise";
    }
    case "fiscal_legal": {
      const reason = v.reason || "Fiscal / legal — the OS never drafts these. Read it yourself.";
      const title = `Email · ${thread.from_name || thread.from_address || "someone"}: ${(thread.subject || "(no subject)").slice(0, 120)}`;
      const body = `${msg.body_text ? msg.body_text.slice(0, 600) : "(no text)"}\n\nFrom ${thread.from_address || "?"} · received ${msg.received_at || "?"} · mailbox ${account.address}`;
      const reg = await registerNeedsYou(svc, { entity_code: code === "IFL" ? "IFL" : code, entity_id: thread.entity_id, title, body, due: v.needs_you_due || null, source: "email_channel", context: { thread_id: thread.id, category: "fiscal_legal", due: v.needs_you_due || null } });
      const err = await label(svc, account, thread.gmail_thread_id, [LABEL_NEEDS_YOU], false);
      await svc.from("email_threads").update({ status: "flagged", flagged: true, flag_reason: reason, register_id: reg.id, error: reg.error || err || null }).eq("id", thread.id);
      return `flagged → register (${reg.via})`;
    }
    case "supplier_doc": {
      const results: string[] = [];
      let anyFiled = false;
      const atts: any[] = Array.isArray(msg.attachments) ? msg.attachments : [];
      for (const a of atts) {
        if (!a.storage_path || !CAPTURE_MIMES.has(String(a.mime))) continue;
        if (a.capture_id) { anyFiled = true; continue; }        // already captured on a previous pass
        if (!code) { a.capture_status = "no_capture_for_entity"; continue; }
        const dl = await svc.storage.from(ATTACHMENT_BUCKET).download(a.storage_path);
        if (dl.error || !dl.data) { a.capture_status = `download: ${dl.error?.message || "empty"}`; continue; }
        const buf = await dl.data.arrayBuffer();
        const extraFlags = account.forwards_to_holded ? ["holded_scanner_copy"] : [];
        const r = await ingestCapture({
          sb: svc, uid: account.connected_by || "00000000-0000-0000-0000-000000000000", buf, mediaType: String(a.mime), filename: a.filename,
          sessionCode: code, source: "email_forward", system: { connected_by: account.connected_by, extraFlags },
        });
        if (!r.ok) { a.capture_status = `failed: ${r.error}`; results.push(`${a.filename}: ${r.error}`); continue; }
        a.capture_table = r.table; a.capture_id = r.id; a.capture_status = r.status;
        results.push(`${a.filename}: ${r.status}`);
        if (r.status === "filed" || r.status === "needs_triage") anyFiled = true;
        if (r.status === "already_captured" || r.status === "duplicate" || r.status === "conflicting_copies") anyFiled = true;
        // Dedup against Holded's purchases for a freshly filed factura (intake ruling (a)).
        if (r.status === "filed" && r.table === "invoice_inbox" && (code === "BM" || code === "IFL" || code === "BBH")) {
          try {
            const key = await workingHoldedKey(code);
            if (key) {
              const { data: row } = await svc.from("invoice_inbox").select("id, entity_id, doc_type, flags, match_status, holded_doc_id, holded_pushed_at, vat_bands, supplier_name, supplier_vat_id, invoice_number, document_date, due_date, grand_total_eur, storage_path, file_sha256, holded_push_log, supplier_id, ocr_extracted").eq("id", r.id).maybeSingle();
              if (row) {
                const cands = await findInHolded(key, row as any);
                const strong = cands.filter((c) => c.why === "same doc number" || c.why === "same supplier + total");
                if (strong.length) {
                  const flags = Array.from(new Set([...(((row as any).flags as string[]) || []), "in_holded_already"]));
                  await svc.from("invoice_inbox").update({ flags, ocr_extracted: { ...((row as any).ocr_extracted || {}), holded_candidates: strong } }).eq("id", r.id);
                  a.capture_status = `${r.status} · already in Holded (${strong[0].docNumber || strong[0].id})`;
                }
              }
            }
          } catch (e: any) { a.holded_check = String(e?.message || e).slice(0, 200); }
        }
      }
      await svc.from("email_messages").update({ attachments: atts }).eq("id", msg.id);
      if (anyFiled) {
        const err = await label(svc, account, thread.gmail_thread_id, [LABEL_CAPTURED], true);
        await svc.from("email_threads").update({ status: "archived", error: err }).eq("id", thread.id);
        return `captured → archived (${results.join("; ") || "already"})`;
      }
      // nothing could be filed → show it as a card so a human sees it
      await svc.from("email_threads").update({ status: "classified", error: results.length ? results.join("; ").slice(0, 400) : "no readable attachment" }).eq("id", thread.id);
      return "card (supplier_doc, nothing captured)";
    }
    case "enquiry":
    case "booking_change":
    case "other":
    default: {
      await svc.from("email_threads").update({ status: "classified" }).eq("id", thread.id);
      return "card";
    }
  }
}

// ---------------------------------------------------------------- sweep (after each pull; trigger stragglers)
export async function sweepNewThreads(svc: SupabaseClient, opts: { entityId?: string | null; limit?: number } = {}): Promise<{ classified: number; failed: number; by_category: Record<string, number> }> {
  const out = { classified: 0, failed: 0, by_category: {} as Record<string, number> };
  let q = svc.from("email_threads").select("id").eq("status", "new").order("last_received_at", { ascending: false }).limit(Math.min(opts.limit || 20, 40));
  if (opts.entityId) q = q.eq("entity_id", opts.entityId);
  const { data } = await q;
  for (const row of data || []) {
    const r = await classifyThread(svc, (row as any).id);
    if (!r.ok) { out.failed++; continue; }
    out.classified++;
    if (r.category) out.by_category[r.category] = (out.by_category[r.category] || 0) + 1;
  }
  return out;
}

// A human says "wrong category": re-route with the correction and remember it.
export async function recategorise(svc: SupabaseClient, threadId: string, category: Category, uid: string): Promise<ClassifyResult> {
  if (!CATEGORIES.includes(category)) return { ok: false, id: threadId, error: "unknown category" };
  const { data: t } = await svc.from("email_threads").select("id, entity_id, account_id, gmail_thread_id, subject, status, from_address, from_name, last_message_id, first_received_at, category").eq("id", threadId).maybeSingle();
  const thread = t as ThreadRow | null;
  if (!thread) return { ok: false, id: threadId, error: "not_found" };
  const msg = await latestInbound(svc, threadId);
  if (!msg) return { ok: false, id: threadId, error: "no inbound message" };
  const was = thread.category;
  await svc.from("email_threads").update({ category, confidence: 1, classified_by: `human:${uid}`, classified_at: new Date().toISOString(), flagged: false, flag_reason: null, error: null }).eq("id", threadId);
  const routed = await routeThread(svc, thread, msg, { category, confidence: 1, by: `human:${uid}` });
  // every misclassification correction is an observation (brief: Observe)
  try {
    await observe(svc, { entity_id: thread.entity_id, source: "email_channel", domain: "comms", subject: domainOf(thread.from_address) || null,
      body: `Email misclassified: ${was || "unclassified"} → ${category} · from ${domainOf(thread.from_address) || "?"} · "${(thread.subject || "").slice(0, 80)}"` });
  } catch { /* best-effort */ }
  return { ok: true, id: threadId, category, confidence: 1, by: `human:${uid}`, routed };
}
