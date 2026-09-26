import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { supabaseJob } from "@/lib/supabaseJob";
import { requireManagerOf } from "@/lib/access/requireManager";
import { getEntityCredential } from "@/lib/integrations/credentials";
import { holdedContacts } from "@/lib/capture/holded";
import { refreshTicketStatus, ticketsWithoutDetails } from "@/lib/capture/tickets";
import { facturaRequestDraft, normTaxId, num } from "@/lib/capture/pure";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/capture/chase — the one-click factura request for a ticket (§13).
//   { id, action: "draft" }                                   enrichment + the drafted email. Sends nothing.
//   { id, action: "mark_requested", to }                      Boris sent it → awaiting_factura
//   { id, action: "not_obtainable", note }                    no factura possible → non-deductible
//   { id, action: "set_billing", invoice_issued_by?, billing_mode? }   e.g. Solred → CaixaBank, monthly
//   { id, action: "recheck" }                                 look again for a factura in the OS
// Nothing here ever sends an email.

const SLUG: Record<string, string> = { BM: "bm", IFL: "taller", BBH: "holdings" };

export async function POST(req: NextRequest) {
  try {
    const sb = supabaseServer() as any;
    const b = await req.json().catch(() => ({}));
    const id = String(b?.id || "");
    const action = String(b?.action || "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
    const { data: t } = await sb.from("invoice_inbox")
      .select("id, entity_id, doc_type, supplier_id, supplier_name, supplier_vat_id, ticket_number, document_date, grand_total_eur, factura_status, factura_request, storage_path, flags, triage_log, linked_factura_id")
      .eq("id", id).maybeSingle();
    if (!t) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    if (t.doc_type !== "ticket") return NextResponse.json({ ok: false, error: "only tickets are chased" }, { status: 400 });
    const gate = await requireManagerOf(sb, t.entity_id);
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
    const job = supabaseJob();
    const log = Array.isArray(t.triage_log) ? t.triage_log : [];
    const stamp = (extra: Record<string, unknown>) => [...log, { at: new Date().toISOString(), by: gate.uid, action: "chase_" + action, ...extra }];
    const { data: sup } = t.supplier_id
      ? await job.from("controller_suppliers").select("id, name, cif, email, phone, address, website, invoice_issued_by, billing_mode, registered_for, enrichment").eq("id", t.supplier_id).maybeSingle()
      : { data: null };

    if (action === "recheck") return NextResponse.json({ ok: true, status: await refreshTicketStatus(sb, id) });

    if (action === "draft") {
      if (t.linked_factura_id) return NextResponse.json({ ok: true, resolved: true, factura: t.linked_factura_id });
      const status = await refreshTicketStatus(sb, id);
      if (status === "resolved") return NextResponse.json({ ok: true, resolved: true });
      // Who we are, as printed on the request.
      const { data: ent } = await job.from("entities").select("legal_name, tax_id, address_line1, postal_code, city").eq("slug", SLUG[t.entity_id] || "").maybeSingle();
      if (!ent?.legal_name || !ent?.tax_id) return NextResponse.json({ ok: false, error: `no fiscal details on file for ${t.entity_id}` }, { status: 409 });
      const address = [ent.address_line1, [ent.postal_code, ent.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null;

      // Where to send it: supplier record, then Holded's contact on the same CIF.
      const to: { email: string; from: string }[] = [];
      if (sup?.email) to.push({ email: sup.email, from: "printed on their documents / supplier record" });
      try {
        const key = ["BM", "IFL", "BBH"].includes(t.entity_id) ? await getEntityCredential(t.entity_id, "holded") : null;
        if (key && normTaxId(t.supplier_vat_id)) {
          for (const c of await holdedContacts(key)) {
            if (normTaxId(c.code) !== normTaxId(t.supplier_vat_id) && normTaxId(c.vatnumber) !== normTaxId(t.supplier_vat_id)) continue;
            if (c.email && !to.some((x) => x.email === c.email)) to.push({ email: c.email, from: `Holded contact "${c.name}"` });
          }
        }
      } catch { /* enrichment is best-effort */ }

      const isClient = status === "requestable_client";
      const draft = facturaRequestDraft({
        template: isClient ? "client" : "new", supplier: t.supplier_name || sup?.name || "", ticket: t.ticket_number,
        date: t.document_date, amount: num(t.grand_total_eur), us: { legal_name: ent.legal_name, tax_id: ent.tax_id, address },
      });
      const signed = t.storage_path ? await sb.storage.from("captures").createSignedUrl(t.storage_path, 60 * 60 * 24 * 7) : null;
      const count = t.supplier_id ? await ticketsWithoutDetails(sb, t.supplier_id, t.entity_id) : 0;
      return NextResponse.json({
        ok: true, status, template: isClient ? "client" : "new", to, draft, ticket_url: signed?.data?.signedUrl || null,
        issuer: sup?.invoice_issued_by || null, billing_mode: sup?.billing_mode || null,
        supplier: sup ? { name: sup.name, cif: sup.cif, phone: sup.phone, address: sup.address, website: sup.website } : null,
        standing_fix: count >= 3 ? `${count} tickets from ${sup?.name || t.supplier_name} without our details for ${t.entity_id}: register our CIF with them once so every purchase prints as a factura.` : null,
        mailbox: "not connected — the admin@ mailboxes aren't linked to the OS yet, so prior correspondence wasn't searched",
        fiscal_address_missing: !address,
      });
    }

    if (action === "mark_requested") {
      const toAddr = String(b?.to || "").trim().slice(0, 200);
      const reqs = Array.isArray(t.factura_request) ? t.factura_request : [];
      await sb.from("invoice_inbox").update({
        factura_status: "awaiting_factura",
        factura_request: [...reqs, { at: new Date().toISOString(), by: gate.uid, to: toAddr || null }],
        triage_log: stamp({ to: toAddr || null }),
      }).eq("id", id);
      // A "new client" request registered our details with them.
      if (sup && !((sup.registered_for || {})[t.entity_id])) {
        await job.from("controller_suppliers").update({ registered_for: { ...(sup.registered_for || {}), [t.entity_id]: new Date().toISOString().slice(0, 10) } }).eq("id", sup.id);
      }
      return NextResponse.json({ ok: true, status: "awaiting_factura" });
    }

    if (action === "not_obtainable") {
      const note = String(b?.note || "").trim();
      if (note.length < 3) return NextResponse.json({ ok: false, error: "note required" }, { status: 400 });
      await sb.from("invoice_inbox").update({
        factura_status: "not_obtainable", flags: Array.from(new Set([...(t.flags || []), "non_deductible"])), triage_log: stamp({ note }),
      }).eq("id", id);
      return NextResponse.json({ ok: true, status: "not_obtainable" });
    }

    if (action === "set_billing") {
      if (!sup) return NextResponse.json({ ok: false, error: "no supplier on this ticket" }, { status: 409 });
      const patch: Record<string, unknown> = {};
      if (typeof b?.invoice_issued_by === "string") patch.invoice_issued_by = b.invoice_issued_by.trim().slice(0, 120) || null;
      if (b?.billing_mode === "per_transaction" || b?.billing_mode === "consolidated_monthly") patch.billing_mode = b.billing_mode;
      if (!Object.keys(patch).length) return NextResponse.json({ ok: false, error: "nothing to set" }, { status: 400 });
      await job.from("controller_suppliers").update(patch).eq("id", sup.id);
      await sb.from("invoice_inbox").update({ triage_log: stamp(patch) }).eq("id", id);
      // Re-decide every open ticket from this supplier.
      const { data: open } = await sb.from("invoice_inbox").select("id").eq("supplier_id", sup.id).eq("doc_type", "ticket")
        .in("factura_status", ["unchecked", "requestable_client", "requestable_new", "consolidated"]);
      for (const o of (open || []) as any[]) await refreshTicketStatus(sb, o.id);
      return NextResponse.json({ ok: true, refreshed: (open || []).length });
    }

    return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
