// Files INBOX — Anthropic vision classifier.
//
// The inbox stores raw attachments dropped by admin@ Gmail scans, WhatsApp
// forwards, and the Chef FAB camera. Boris still confirms every filing,
// but the classifier does the heavy lifting: pick the category, guess the
// entity, extract a decent title, and (for expiring paperwork) pull a
// valid_until date so the library's amber-badge is ready on day one.
//
// Model choice: claude-haiku-4-5. Vision-capable, fast enough for a
// per-attachment call from the cron sweep, cheap enough to run on every
// stray PDF that lands.
//
// If ANTHROPIC_API_KEY isn't set we bail into a dry-run fallback — the row
// still reaches needs_triage, but confidence is 0 and the rationale explains
// why. That keeps the triage UI functional in dev/preview without paying
// tokens.

import { supabaseServer } from "@/lib/supabaseServer";

// Categories that mirror files_documents.category — plus 'modelo' and
// 'photo' which are inbox-only observations (modelos map to 'gestoria'
// once filed; photos map to 'brand' or 'other').
export const INBOX_CATEGORIES = [
  "contract","statement","modelo","haccp","insurance",
  "certification","menu_pdf","photo","other",
] as const;
export type InboxCategory = typeof INBOX_CATEGORIES[number];

export const ENTITIES = ["IFL","BM","BBH"] as const;
export type EntityCode = typeof ENTITIES[number];

// The one-shot JSON schema we ask the model for. Keeping it flat because
// claude's JSON reliability drops off with nesting; we validate + coerce
// on our side.
const SYSTEM = `You are classifying a business document (attached image or PDF page).

Return ONLY JSON. No prose, no fences. Fields:
{
  "category": one of ["contract","statement","modelo","haccp","insurance","certification","menu_pdf","photo","other"],
  "entity":   one of ["IFL","BM","BBH"] or null if truly ambiguous,
  "title":    <= 80 chars, human-readable, e.g. "Mercadona statement – May 2026",
  "valid_until": "YYYY-MM-DD" only if this is a cert / contract / insurance with a clear expiry, otherwise null,
  "confidence": 0..1 (0.85+ if unambiguous, 0.65-0.85 if reasonable guess, <0.65 if a coin flip),
  "rationale": one short sentence explaining the call.
}

Entity hints:
- IFL = Ibiza Food Lab SL (aka Taller Sa Penya / restaurant Utopia). Look for CIF B16656778.
- BM  = Bistrot Mondo SL. Look for CIF B76281099 or brand Bistrot Mondo.
- BBH = Buenos Buenos Holdings SL (holding). CIF B16776352. Rarely receives operational docs.
If you see the sender's email domain (@bistro-mondo.com => BM, @ibzfoodstudio.com => IFL) trust it over the visual content.

Category hints:
- "modelo" = a Spanish tax return form (Mod 111, 115, 200, 303, 349, 390...). It is NOT haccp, contract, or gestoria.
- "statement" = a supplier or bank statement with a running balance.
- "contract" = a signed agreement with two parties and terms.
- "haccp" = food-safety records (fridge temps, cleaning logs, allergen forms).
- "certification" = a training or hygiene certificate.
- "insurance" = a policy schedule or renewal notice.
- "menu_pdf" = a restaurant menu (ours or theirs).
- "photo" = a phone picture with no document structure.
- "other" = anything else.`;

// Simplified "email context" the caller passes so the model can lean on
// From: / Subject: even when the vision is grainy.
export type ClassifyContext = {
  source: string;
  sender?: string | null;
  subject?: string | null;
  filename?: string | null;
};

export type ClassifyResult = {
  category: InboxCategory | null;
  entity: EntityCode | null;
  title: string | null;
  valid_until: string | null; // ISO date
  confidence: number;         // 0..1
  rationale: string;
  dry_run: boolean;
};

// Map an inbox category to a files_documents category (which uses a
// slightly narrower vocabulary). Modelos file as "gestoria" (that's where
// their sibling documents live), photos file as "brand".
export function inboxCategoryToLibraryCategory(c: InboxCategory | null): string {
  switch (c) {
    case "contract":      return "contract";
    case "statement":     return "statement";
    case "modelo":        return "gestoria";
    case "haccp":         return "haccp";
    case "insurance":     return "insurance";
    case "certification": return "certification";
    case "menu_pdf":      return "menu_pdf";
    case "photo":         return "brand";
    case "other":
    default:              return "other";
  }
}

// Load raw bytes from Supabase Storage.
async function loadBytes(path: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const sb = supabaseServer();
  // path is stored as "documents-inbox/<yyyy-mm-dd>/<id>_<name>" — strip the
  // bucket prefix if present.
  const bucket = "documents-inbox";
  const key = path.startsWith(bucket + "/") ? path.slice(bucket.length + 1) : path;
  const { data, error } = await sb.storage.from(bucket).download(key);
  if (error || !data) return null;
  const buf = await data.arrayBuffer();
  return { bytes: new Uint8Array(buf), mime: data.type || "application/octet-stream" };
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

// Sanity checks + coercion — the model occasionally returns strings for
// numbers, or `"null"` as a literal, or picks a category we didn't list.
// Anything shaky drops confidence to a safe amber.
function coerce(raw: any, ctx: ClassifyContext): ClassifyResult {
  const cat = String(raw?.category || "").toLowerCase();
  const category: InboxCategory | null = (INBOX_CATEGORIES as readonly string[]).includes(cat)
    ? (cat as InboxCategory)
    : null;

  const ent = String(raw?.entity || "").toUpperCase();
  const entity: EntityCode | null = (ENTITIES as readonly string[]).includes(ent)
    ? (ent as EntityCode)
    : null;

  let title = typeof raw?.title === "string" ? raw.title.trim().slice(0, 80) : "";
  if (!title) title = (ctx.subject || ctx.filename || "Untitled").slice(0, 80);

  let vu: string | null = null;
  const rawVu = raw?.valid_until;
  if (typeof rawVu === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rawVu)) vu = rawVu;

  let confidence = Number(raw?.confidence);
  if (!Number.isFinite(confidence) || confidence < 0) confidence = 0;
  if (confidence > 1) confidence = 1;
  // If the model didn't give us a category, cap confidence.
  if (!category) confidence = Math.min(confidence, 0.4);

  const rationale = typeof raw?.rationale === "string"
    ? raw.rationale.trim().slice(0, 400)
    : "No rationale returned.";

  return { category, entity, title, valid_until: vu, confidence, rationale, dry_run: false };
}

// Detect an entity from the sender domain — cheap hint that survives when
// vision returns null.
function entityFromSender(sender: string | null | undefined): EntityCode | null {
  const s = (sender || "").toLowerCase();
  if (s.includes("@bistro-mondo.com") || s.includes("bistrot mondo") || s.includes("bistro mondo")) return "BM";
  if (s.includes("@ibzfoodstudio.com") || s.includes("ibiza food") || s.includes("taller sa penya")) return "IFL";
  if (s.includes("holdings")) return "BBH";
  return null;
}

// Detect an entity from the source enum (admin@ mailbox is a strong signal).
function entityFromSource(source: string): EntityCode | null {
  if (source === "gmail_admin_bm") return "BM";
  if (source === "gmail_admin_ifl") return "IFL";
  if (source === "gmail_admin_bbh") return "BBH";
  return null;
}

// Main entry — takes an inbox row id, loads the file, calls the model,
// writes the suggested_* fields back. Idempotent: if the row is already
// classified/filed/rejected the call is a no-op.
export async function classifyFile(inbox_id: string): Promise<{ ok: boolean; result?: ClassifyResult; error?: string }> {
  const sb = supabaseServer();
  const { data: row, error: readErr } = await sb.from("files_inbox")
    .select("id,file_url,mime_type,status,source,sender,subject")
    .eq("id", inbox_id)
    .maybeSingle();
  if (readErr || !row) return { ok: false, error: "inbox row not found" };
  if (row.status !== "pending_classify") {
    return { ok: true, result: undefined };
  }

  const ctx: ClassifyContext = {
    source: row.source,
    sender: row.sender,
    subject: row.subject,
    filename: (row.file_url as string).split("/").pop() || null,
  };

  const key = process.env.ANTHROPIC_API_KEY;
  const senderHint = entityFromSender(ctx.sender) || entityFromSource(ctx.source);

  // ----------------------------------------------------------------------
  // Dry-run fallback — no API key. Push to needs_triage with confidence 0
  // and a rationale that tells the operator why nothing was suggested.
  // ----------------------------------------------------------------------
  if (!key) {
    const result: ClassifyResult = {
      category: null,
      entity: senderHint,
      title: (ctx.subject || ctx.filename || "Untitled").slice(0, 80),
      valid_until: null,
      confidence: 0,
      rationale: "Vision classifier is off in this environment (ANTHROPIC_API_KEY not set). Route via the /files/inbox drawer and pick a category manually.",
      dry_run: true,
    };
    await writeClassification(inbox_id, result);
    return { ok: true, result };
  }

  const load = await loadBytes(row.file_url as string);
  if (!load) {
    const result: ClassifyResult = {
      category: null,
      entity: senderHint,
      title: (ctx.subject || ctx.filename || "Untitled").slice(0, 80),
      valid_until: null,
      confidence: 0,
      rationale: "Could not load the attachment from storage. It's in the queue but the classifier couldn't read it — triage manually.",
      dry_run: false,
    };
    await writeClassification(inbox_id, result);
    return { ok: true, result };
  }

  const mime = row.mime_type || load.mime || "application/octet-stream";
  const isImage = mime.startsWith("image/");
  const isPdf = mime === "application/pdf";
  if (!isImage && !isPdf) {
    // Non-visual attachment (docx, xlsx). Skip vision — dry-run fallback.
    const result: ClassifyResult = {
      category: null,
      entity: senderHint,
      title: (ctx.subject || ctx.filename || "Untitled").slice(0, 80),
      valid_until: null,
      confidence: 0,
      rationale: `Attachment mime ${mime} — vision skipped. Triage manually.`,
      dry_run: false,
    };
    await writeClassification(inbox_id, result);
    return { ok: true, result };
  }

  const b64 = toBase64(load.bytes);
  const source: any = isPdf
    ? { type: "base64", media_type: "application/pdf", data: b64 }
    : { type: "base64", media_type: mime, data: b64 };
  const attachmentBlock: any = isPdf
    ? { type: "document", source }
    : { type: "image", source };

  const userText = [
    `Source: ${row.source}`,
    row.sender ? `From: ${row.sender}` : null,
    row.subject ? `Subject: ${row.subject}` : null,
    ctx.filename ? `Filename: ${ctx.filename}` : null,
    "",
    "Classify this document. Return only the JSON described in the system prompt.",
  ].filter(Boolean).join("\n");

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 700,
        system: SYSTEM,
        messages: [{
          role: "user",
          content: [attachmentBlock, { type: "text", text: userText }],
        }],
      }),
    });
    const data: any = await r.json();
    const txt: string = data?.content?.[0]?.text || data?.error?.message || "";
    const m = txt.match(/\{[\s\S]*\}/);
    let parsed: any = null;
    if (m) { try { parsed = JSON.parse(m[0]); } catch { /* ignore */ } }
    if (!parsed) {
      const result: ClassifyResult = {
        category: null,
        entity: senderHint,
        title: (ctx.subject || ctx.filename || "Untitled").slice(0, 80),
        valid_until: null,
        confidence: 0,
        rationale: "Vision call returned no JSON — triage manually. (Raw: " + txt.slice(0, 120) + ")",
        dry_run: false,
      };
      await writeClassification(inbox_id, result);
      return { ok: true, result };
    }
    const result = coerce(parsed, ctx);
    // If sender-domain says one entity and vision says nothing, use the
    // sender hint. If they disagree, trust the sender (it's rarely wrong).
    if (!result.entity && senderHint) result.entity = senderHint;
    else if (senderHint && result.entity && result.entity !== senderHint) {
      result.entity = senderHint;
      result.confidence = Math.max(0, result.confidence - 0.15);
      result.rationale = "[sender overrides vision] " + result.rationale;
    }
    await writeClassification(inbox_id, result);
    return { ok: true, result };
  } catch (e: any) {
    const result: ClassifyResult = {
      category: null,
      entity: senderHint,
      title: (ctx.subject || ctx.filename || "Untitled").slice(0, 80),
      valid_until: null,
      confidence: 0,
      rationale: "Vision call failed: " + (e?.message || String(e)).slice(0, 200),
      dry_run: false,
    };
    await writeClassification(inbox_id, result);
    return { ok: false, error: e?.message || "vision failed", result };
  }
}

// Write suggested_* fields, move status to needs_triage, and log the action.
async function writeClassification(inbox_id: string, result: ClassifyResult) {
  const sb = supabaseServer();
  await sb.from("files_inbox").update({
    suggested_category: result.category,
    suggested_entity: result.entity,
    suggested_title: result.title,
    suggested_valid_until: result.valid_until,
    classification_confidence: result.confidence,
    classification_rationale: result.rationale,
    status: "needs_triage",
  }).eq("id", inbox_id);

  await sb.from("assistant_actions").insert({
    user_id: null,
    action_kind: "files_inbox_classify",
    action_type: "files.inbox.classify",
    entity_code: result.entity,
    target_table: "files_inbox",
    target_id: inbox_id,
    payload: {
      category: result.category,
      title: result.title,
      valid_until: result.valid_until,
      confidence: result.confidence,
      rationale: result.rationale,
      dry_run: result.dry_run,
    },
    reversible: true,
  });
}
