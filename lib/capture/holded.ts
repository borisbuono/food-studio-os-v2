// Capture funnel → Holded. ONE document per call, only on a human tick.
//
//   preflight        : blockers + is it already in Holded? + the exact payload
//   create           : dedup again → POST purchase (draft) → attach PDF → read back
//                      attach or read-back failure → DELETE the draft we just made
//   attach_existing  : the invoice IS in Holded already → attach the PDF to that
//                      doc, never delete/recreate ([[holded_attach_document_beats_delete]])
//
// Known Holded behaviour this respects (finance lane, verified on live API):
//   • POST /documents/{type}/{id}/attach, multipart "file" → 201 {"status":1}.
//     It returns NO attachment id, and no API lists attachments (the list
//     payload's attachedDocuments is always null; /attachments 404s). So the
//     stored reference is "attach:<http status>:<sha256>" plus the response.
//   • Never PUT an existing purchase — it drops docNumber and resets accounts.
//   • Line accounts can't be set reliably via API → lines go one per VAT band
//     on the default purchase account; the accountant codes them in Holded.
//   • Created docs are left UNAPPROVED (approveDoc:false). Approved ≠ posted.
//   • /documents/purchase silently caps at 500 rows → query month by month.
//   • Dates are Madrid-midnight epochs.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getEntityCredential } from "@/lib/integrations/credentials";
import { supabaseJob } from "@/lib/supabaseJob";
import { normDocNo, normName, normTaxId, pushBlockers, r2, resolveHoldedContact, holdedTaxKey, bandTotals, isSelfAssessed, type ContactVerdict, type HContact, type VatBand } from "@/lib/capture/pure";

const V1 = "https://api.holded.com/api/invoicing/v1";
const DRY_RUN = process.env.FS_HOLDED_DRY_RUN !== "false";

type Row = {
  id: string; entity_id: string; doc_type: string | null; flags: string[] | null; match_status: string | null;
  holded_doc_id: string | null; holded_pushed_at: string | null; vat_bands: VatBand[] | null;
  supplier_name: string | null; supplier_vat_id: string | null; invoice_number: string | null;
  document_date: string | null; due_date: string | null; grand_total_eur: number | null;
  storage_path: string | null; file_sha256: string | null; holded_push_log: any; supplier_id: string | null;
};
const COLS = "id, entity_id, doc_type, flags, match_status, holded_doc_id, holded_pushed_at, vat_bands, supplier_name, supplier_vat_id, invoice_number, document_date, due_date, grand_total_eur, storage_path, file_sha256, holded_push_log, supplier_id";

// "2026-07-17" → unix seconds of 00:00 Europe/Madrid.
export function madridEpoch(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  const utcNoon = new Date(Date.UTC(y, m - 1, d, 12));
  const off = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Madrid", timeZoneName: "shortOffset" })
    .formatToParts(utcNoon).find((p) => p.type === "timeZoneName")?.value || "GMT+1";
  const mm = off.match(/GMT([+-])(\d+)(?::(\d+))?/);
  const mins = mm ? (mm[1] === "-" ? -1 : 1) * (Number(mm[2]) * 60 + Number(mm[3] || 0)) : 60;
  return Math.floor((Date.UTC(y, m - 1, d) - mins * 60000) / 1000);
}
const dayOf = (epoch: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date(epoch * 1000));

async function h(key: string, path: string, init: RequestInit = {}) {
  const r = await fetch(V1 + path, { ...init, headers: { key, accept: "application/json", ...(init.headers || {}) } });
  const text = await r.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, ok: r.ok, json, text: text.slice(0, 500) };
}

// Holded purchases dated within ±days of `day`, month-chunked under the 500 cap.
async function purchasesAround(key: string, day: string, days = 45) {
  const center = madridEpoch(day);
  const start = center - days * 86400, end = center + days * 86400;
  const out: any[] = [];
  for (let t = start; t < end; t += 30 * 86400) {
    const e = Math.min(end, t + 30 * 86400);
    const r = await h(key, `/documents/purchase?starttmp=${t}&endtmp=${e}`);
    if (!r.ok || !Array.isArray(r.json)) throw new Error(`Holded list ${r.status}: ${r.text.slice(0, 120)}`);
    if (r.json.length >= 500) throw new Error("Holded list hit the 500-row cap — window too wide, refusing to decide");
    out.push(...r.json);
  }
  return out;
}

export type HoldedCandidate = { id: string; docNumber: string | null; contactName: string | null; date: string; total: number; why: string };

export async function findInHolded(key: string, row: Row): Promise<HoldedCandidate[]> {
  if (!row.document_date) return [];
  const docs = await purchasesAround(key, row.document_date);
  const no = normDocNo(row.invoice_number);
  const sup = normName(row.supplier_name);
  const tot = Number(row.grand_total_eur ?? NaN);
  const seen = new Set<string>();
  const out: HoldedCandidate[] = [];
  for (const d of docs) {
    if (!d?.id || seen.has(d.id)) continue;
    const dn = normDocNo(d.docNumber || d.invoiceNum);
    const cn = normName(d.contactName);
    const dt = Number(d.total ?? NaN);
    const sameSup = !!sup && !!cn && (cn.includes(sup) || sup.includes(cn));
    const sameTot = Number.isFinite(tot) && Number.isFinite(dt) && Math.abs(dt - tot) <= 0.01;
    let why = "";
    if (no && dn && dn === no) why = sameSup || sameTot ? "same doc number" : "same doc number, other supplier?";
    else if (sameTot && sameSup) why = "same supplier + total";
    else if (sameTot && dayOf(Number(d.date)) === row.document_date) why = "same total + date";
    if (!why) continue;
    seen.add(d.id);
    out.push({ id: d.id, docNumber: d.docNumber || null, contactName: d.contactName || null, date: dayOf(Number(d.date)), total: dt, why });
  }
  return out;
}

export async function holdedContacts(key: string): Promise<HContact[]> {
  const r = await h(key, "/contacts");
  if (!r.ok || !Array.isArray(r.json)) throw new Error(`Holded contacts ${r.status}`);
  return r.json.map((c: any) => ({ id: c.id, name: c.name, code: c.code, vatnumber: c.vatnumber, tradeName: c.tradeName, type: c.type, email: c.email || null }));
}

export type ContactChoice = { contact_id?: string; contact_new?: boolean };

// Decide which Holded contact the purchase goes to. Only a single CIF hit is
// automatic; lookalikes or a shared CIF need Boris to pick (or say "new").
function contactDecision(v: ContactVerdict, choice: ContactChoice): { ok: true; contactId: string | null } | { ok: false; blocker: string } {
  if (v.kind === "cif") return { ok: true, contactId: v.id };
  if (choice.contact_id) {
    if (v.kind === "choose" && v.candidates.some((c) => c.id === choice.contact_id)) return { ok: true, contactId: choice.contact_id };
    return { ok: false, blocker: "holded_contact_not_a_candidate" };
  }
  if (v.kind === "new") return { ok: true, contactId: null };
  if (choice.contact_new && v.reason === "name_lookalikes") return { ok: true, contactId: null };
  return { ok: false, blocker: v.reason === "same_cif_several_contacts" ? "holded_contact_pick_one_same_cif" : "holded_contact_check_lookalikes" };
}

const REGIME_LABEL: Record<string, string> = {
  iva: "IVA", iva_nd: "IVA no deducible", iva_bi: "IVA bien de inversión", intra_goods: "Adq. intracom. bienes",
  intra_services: "Adq. intracom. servicios", isp: "Inversión sujeto pasivo", import: "Importación",
  exempt: "Exento", not_subject: "No sujeto",
};

// One item per tax band. IRPF is not an item: Holded carries it as `retention`
// on the items it applies to — only when it applies to the whole base.
export function buildItems(row: Row): { items: any[]; problem: string | null } {
  const all = (row.vat_bands || []).filter((b) => b.base !== 0);
  const ret = all.filter((b) => b.regime === "retention");
  const bands = all.filter((b) => b.regime !== "retention");
  if (ret.length > 1) return { items: [], problem: "more_than_one_irpf_rate" };
  const baseSum = r2(bands.reduce((a, b) => a + b.base, 0));
  if (ret.length && Math.abs(ret[0].base - baseSum) > 0.02) return { items: [], problem: "irpf_on_part_of_the_base" };
  const items = bands.map((b) => {
    const key = holdedTaxKey(b);
    const reg = b.regime || "iva";
    return {
      name: `Base imponible ${REGIME_LABEL[reg] || reg} ${b.rate}%`.replace(/ 0%$/, reg === "exempt" || reg === "not_subject" ? "" : " 0%"),
      units: 1, subtotal: r2(b.base), tax: reg === "exempt" || reg === "not_subject" ? 0 : b.rate, taxes: key ? [key] : [],
      ...(ret.length ? { retention: ret[0].rate } : {}),
    };
  });
  return { items, problem: null };
}

export function buildPayload(row: Row, contactId: string | null = null) {
  return {
    ...(contactId ? { contactId } : { contactCode: normTaxId(row.supplier_vat_id) || undefined, contactName: row.supplier_name || undefined }),
    date: madridEpoch(row.document_date!),
    dueDate: row.due_date ? madridEpoch(row.due_date) : undefined,
    invoiceNum: row.invoice_number || undefined,
    approveDoc: false,
    desc: `${row.supplier_name || "Proveedor"} ${row.invoice_number || ""}`.trim(),
    notes: `FS OS capture ${row.id} · PDF adjunto · una línea por impuesto`,
    items: buildItems(row).items,
  };
}

async function loadRow(sb: SupabaseClient, id: string): Promise<Row | null> {
  const { data } = await sb.from("invoice_inbox").select(COLS).eq("id", id).maybeSingle();
  return (data as any) || null;
}

async function logPush(sb: SupabaseClient, row: Row, entry: Record<string, unknown>, patch: Record<string, unknown> = {}) {
  const log = Array.isArray(row.holded_push_log) ? row.holded_push_log : [];
  log.push({ at: new Date().toISOString(), ...entry });
  row.holded_push_log = log;
  await sb.from("invoice_inbox").update({ holded_push_log: log, ...patch }).eq("id", row.id);
}

export type PushResult =
  | { ok: true; mode: "preflight"; blockers: string[]; warnings: string[]; in_holded: HoldedCandidate[]; payload: unknown; dry_run: boolean;
      contact: ContactVerdict; supplier: { id: string | null; name: string | null; cif: string | null; unreviewed: boolean } }
  | { ok: true; mode: "create" | "attach_existing"; holded_doc_id: string; attachment_ref: string; readback: unknown; dry_run: false }
  | { ok: true; mode: "create"; dry_run: true; payload: unknown }
  | { ok: false; status: number; error: string; detail?: unknown };

export async function pushToHolded(sb: SupabaseClient, uid: string, id: string, mode: "preflight" | "create" | "attach_existing", holdedId?: string, choice: ContactChoice = {}): Promise<PushResult> {
  const row = await loadRow(sb, id);
  if (!row) return { ok: false, status: 404, error: "not found" };
  const ent = row.entity_id as "BM" | "IFL" | "BBH";
  if (!["BM", "IFL", "BBH"].includes(ent)) return { ok: false, status: 400, error: `no Holded for entity ${row.entity_id}` };
  const key = await getEntityCredential(ent, "holded");
  if (!key) return { ok: false, status: 500, error: `no Holded key for ${ent}` };

  const blockers = pushBlockers(row as any);
  if (!row.document_date) blockers.push("no_document_date");
  if (!row.storage_path) blockers.push("no_pdf");
  const warnings = (row.flags || []).filter((f) => !blockers.includes(f));

  // A supplier the funnel created on first sight must be looked at once by a
  // human before anything is posted against it.
  let supplier = { id: row.supplier_id, name: row.supplier_name, cif: row.supplier_vat_id, unreviewed: false };
  if (row.supplier_id) {
    const { data: sup } = await supabaseJob().from("controller_suppliers").select("id, name, cif, notes").eq("id", row.supplier_id).maybeSingle();
    if (sup) supplier = { id: (sup as any).id, name: (sup as any).name, cif: (sup as any).cif, unreviewed: /capture funnel .* — review$/.test(String((sup as any).notes || "")) };
  }
  if (supplier.unreviewed) blockers.push("supplier_unreviewed");

  let inHolded: HoldedCandidate[] = [];
  let contact: ContactVerdict;
  try {
    inHolded = await findInHolded(key, row);
    contact = resolveHoldedContact(row.supplier_vat_id, row.supplier_name, await holdedContacts(key));
  } catch (e: any) { return { ok: false, status: 502, error: "could not check Holded: " + (e?.message || e) }; }
  const cd = contactDecision(contact, choice);
  // Every tax key must exist and be switched on in THIS company's Holded.
  const bi = buildItems(row);
  if (bi.problem) blockers.push(bi.problem);
  try {
    const tx = await h(key, "/taxes");
    const live = new Set<string>((Array.isArray(tx.json) ? tx.json : []).filter((t: any) => t.status !== false).map((t: any) => String(t.key)));
    for (const it of bi.items) for (const k of it.taxes as string[]) if (live.size && !live.has(k)) blockers.push(`holded_tax_key_off_${k}`);
  } catch { /* the read-back still checks keys */ }
  if (mode !== "attach_existing" && !cd.ok && !(mode === "preflight" && contact.kind === "choose")) blockers.push(cd.blocker);
  if (contact.kind === "new") warnings.push("new_holded_contact_will_be_created");

  if (mode === "preflight") {
    return { ok: true, mode, blockers, warnings, in_holded: inHolded, payload: buildPayload(row, cd.ok ? cd.contactId : null), dry_run: DRY_RUN, contact, supplier };
  }

  // Fetch the PDF from storage — no PDF, no push.
  const dl = await sb.storage.from("captures").download(row.storage_path || "");
  if (dl.error || !dl.data) return { ok: false, status: 500, error: "cannot read the scanned file from storage" };
  const fileBlob = dl.data;
  const fname = `${ent}_${(row.supplier_name || "proveedor").replace(/[^A-Za-z0-9]+/g, "_")}_${(row.invoice_number || row.id).replace(/[^A-Za-z0-9]+/g, "_")}.${(row.storage_path || "").split(".").pop() || "pdf"}`;

  async function attach(docId: string) {
    const fd = new FormData();
    fd.append("file", fileBlob, fname);
    const r = await h(key!, `/documents/purchase/${docId}/attach`, { method: "POST", body: fd });
    const ok = r.ok && Number(r.json?.status) === 1;
    return { ok, status: r.status, body: r.json ?? r.text };
  }

  if (mode === "attach_existing") {
    if (!holdedId || !inHolded.some((c) => c.id === holdedId)) return { ok: false, status: 409, error: "that Holded doc is not a match for this scan" };
    if (row.holded_doc_id) return { ok: false, status: 409, error: "already linked to Holded " + row.holded_doc_id };
    const a = await attach(holdedId);
    if (!a.ok) { await logPush(sb, row, { step: "attach_existing", holded_id: holdedId, result: a }); return { ok: false, status: 502, error: "attach failed", detail: a }; }
    const ref = `attach:${a.status}:${row.file_sha256 || ""}`;
    await logPush(sb, row, { step: "attach_existing", holded_id: holdedId, result: a, by: uid },
      { holded_doc_id: holdedId, holded_attachment_ref: ref, holded_pushed_at: new Date().toISOString(), holded_pushed_by: uid, match_status: "approved", triaged_by: uid, triaged_at: new Date().toISOString() });
    return { ok: true, mode, holded_doc_id: holdedId, attachment_ref: ref, readback: { note: "existing Holded doc — not modified, PDF attached" }, dry_run: false };
  }

  // mode === "create"
  if (blockers.length) return { ok: false, status: 409, error: "blocked: " + blockers.join(", ") };
  if (inHolded.length) return { ok: false, status: 409, error: "already in Holded — attach to the existing doc instead", detail: inHolded };
  if (!cd.ok) return { ok: false, status: 409, error: "Holded contact not decided: " + cd.blocker };
  const payload = buildPayload(row, cd.contactId);
  if (bi.problem) return { ok: false, status: 409, error: "blocked: " + bi.problem };
  if (!payload.items.length) return { ok: false, status: 409, error: "no tax bands to post" };
  if (payload.items.some((i: any) => !i.taxes.length)) return { ok: false, status: 409, error: "a tax band has no Holded key — accountant" };
  if (DRY_RUN) return { ok: true, mode: "create", dry_run: true, payload };

  // Lock: one push at a time per row (stale after 5 min).
  const stale = new Date(Date.now() - 5 * 60000).toISOString();
  const { data: locked } = await sb.from("invoice_inbox").update({ holded_pushed_at: new Date().toISOString(), holded_pushed_by: uid })
    .eq("id", row.id).is("holded_doc_id", null).or(`holded_pushed_at.is.null,holded_pushed_at.lt.${stale}`).select("id");
  if (!locked || !locked.length) return { ok: false, status: 409, error: "a push for this document is already running" };
  const unlock = () => sb.from("invoice_inbox").update({ holded_pushed_at: null, holded_pushed_by: null }).eq("id", row.id);

  const c = await h(key, "/documents/purchase", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const newId = c.json?.id as string | undefined;
  if (!c.ok || !newId) {
    await unlock();
    await logPush(sb, row, { step: "create", ok: false, status: c.status, body: c.json ?? c.text, payload, by: uid });
    return { ok: false, status: 502, error: `Holded create ${c.status}`, detail: c.json ?? c.text };
  }

  async function rollback(reason: string, detail: unknown): Promise<PushResult> {
    const d = await h(key!, `/documents/purchase/${newId}`, { method: "DELETE" });
    await unlock();
    const orphan = !d.ok;
    await logPush(sb, row!, { step: "rollback", reason, detail, holded_id: newId, delete_status: d.status, by: uid },
      orphan ? { flags: Array.from(new Set([...(row!.flags || []), `holded_orphan_${newId}`])) } : {});
    return { ok: false, status: 502, error: orphan ? `${reason} — AND the rollback delete failed: Holded draft ${newId} must be removed by hand` : `${reason} — Holded draft removed, nothing left behind`, detail };
  }

  const a = await attach(newId);
  if (!a.ok) return rollback("PDF attach failed", a);

  const rb = await h(key, `/documents/purchase/${newId}`);
  const got = rb.json || {};
  const want = Number(row.grand_total_eur);
  const checks = {
    found: rb.ok && got.id === newId,
    total: Math.abs(Number(got.total) - want) <= 0.02,
    date: got.date ? dayOf(Number(got.date)) === row.document_date : false,
    contact: !!(got.contactName || got.contact),
    // Every band landed as IVA at its rate (the finance lane found IGIC codes
    // on old docs — a wrong tax key would pass the total check at 0 % → 0 %).
    taxes: (() => {
      const prods: any[] = Array.isArray(got.products) ? got.products : [];
      const bands = (row!.vat_bands || []).filter((b) => b.base !== 0 && b.regime !== "retention");
      if (prods.length !== bands.length) return false;
      return bands.every((b) => {
        const key = holdedTaxKey(b)!;
        return prods.some((p) => Math.abs(Number(p.price) * Number(p.units || 1) - b.base) <= 0.01
          && (!Array.isArray(p.taxes) || p.taxes.includes(key))
          // group keys (intra / ISP) carry the self-assessed pair; don't insist on p.tax there
          && (isSelfAssessed(b) || b.regime === "exempt" || b.regime === "not_subject" || Number(p.tax) === b.rate));
      });
    })(),
    // Holded may report IRPF inside `tax` (negative) or apart; accept either.
    vat: (() => {
      const t = bandTotals(row!.vat_bands || []);
      const g = Number(got.tax);
      return Math.abs(g - t.vat) <= 0.02 || Math.abs(g - (t.vat - t.retention)) <= 0.02;
    })(),
  };
  if (!checks.found || !checks.total || !checks.date || !checks.contact || !checks.taxes || !checks.vat) {
    return rollback("read-back did not match the scan", { checks, holded_total: got.total, holded_date: got.date, want_total: want });
  }
  const ref = `attach:${a.status}:${row.file_sha256 || ""}`;
  const readback = { ...checks, holded_total: got.total, docNumber: got.docNumber || null, docNumber_matches: normDocNo(got.docNumber) === normDocNo(row.invoice_number), draft: !!got.draft, approved: !!got.approvedAt, status: got.status };
  await logPush(sb, row, { step: "create", ok: true, holded_id: newId, attach: a, readback, payload, by: uid },
    { holded_doc_id: newId, holded_attachment_ref: ref, holded_pushed_at: new Date().toISOString(), holded_pushed_by: uid,
      match_status: "approved", triaged_by: uid, triaged_at: new Date().toISOString() });
  return { ok: true, mode: "create", holded_doc_id: newId, attachment_ref: ref, readback, dry_run: false };
}
