import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { supabaseJob } from "@/lib/supabaseJob";
import { requireManagerOf } from "@/lib/access/requireManager";
import { writeLines } from "@/lib/capture/ingest";
import { matchForSupplier } from "@/lib/capture/match";
import { checkLines, num, type EntityCode } from "@/lib/capture/pure";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/capture/triage — a human clears what the funnel refused to guess.
//   { table, id, action: "set_entity", entity }       guessed entity → confirmed; lines written, matcher run
//   { table, id, action: "ack_flag", flag, note }     printed value checked and correct (note required)
//   { table, id, action: "ack_supplier" }             new supplier looked at once
//   { table, id, action: "reject", note }
// Every action is logged on the row (triage_log) with who and when.

const ACKABLE = new Set(["vat_rate_category_mismatch", "low_confidence", "handwritten_changes"]);
const CODE_RESTAURANT: Partial<Record<EntityCode, string>> = {
  BM: "fb4d008f-2d2a-4e0d-a525-6e0e36af0259", IFL: "ca83e06f-a24d-43d7-bce4-57ac341d190f", UTOPIA: "a0000000-0000-4000-8000-000000000001",
};

export async function POST(req: NextRequest) {
  try {
    const sb = supabaseServer() as any;
    const b = await req.json().catch(() => ({}));
    const table = b?.table === "albarans" ? "albarans" : "invoice_inbox";
    const id = String(b?.id || "");
    const action = String(b?.action || "");
    const note = String(b?.note || "").trim().slice(0, 500);
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });

    const docNoCol = table === "albarans" ? "doc_number" : "invoice_number";
    const { data: row } = await sb.from(table)
      .select(`id, entity_id, entity_source, flags, match_status, supplier_id, document_date, ${docNoCol}, ocr_extracted, triage_log, grand_total_eur`)
      .eq("id", id).maybeSingle();
    if (!row) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    const gate = await requireManagerOf(sb, row.entity_id);
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });

    const log = Array.isArray(row.triage_log) ? row.triage_log : [];
    const stamp = (extra: Record<string, unknown>) => [...log, { at: new Date().toISOString(), by: gate.uid, action, ...extra }];
    const flags: string[] = row.flags || [];

    if (action === "set_entity") {
      const entity = String(b?.entity || "").toUpperCase() as EntityCode;
      if (!["BM", "IFL", "BBH"].includes(entity)) return NextResponse.json({ ok: false, error: "entity must be BM, IFL or BBH" }, { status: 400 });
      if (row.entity_source !== "session_guess") return NextResponse.json({ ok: false, error: "entity was read off the paper — not re-assignable here" }, { status: 409 });
      const g2 = await requireManagerOf(sb, entity);
      if (!g2.ok) return NextResponse.json({ ok: false, error: g2.error }, { status: g2.status });
      const rest = flags.filter((f) => f !== "entity_guessed");
      const stillTriage = rest.includes("low_confidence") || rest.includes("third_party_addressee");
      const { error } = await sb.from(table).update({
        entity_id: entity, restaurant_id: CODE_RESTAURANT[entity] || null, entity_source: "manual", flags: rest,
        match_status: rest.includes("third_party_addressee") ? "rejected" : stillTriage ? "needs_triage" : "unmatched",
        triage_log: stamp({ from: row.entity_id, to: entity, note }),
      }).eq("id", id);
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      let lines = 0, matched: unknown = null;
      if (!stillTriage) {
        const x = row.ocr_extracted || {};
        const lc = checkLines(Array.isArray(x.lines) ? x.lines : [], num(x.subtotal_eur));
        lines = Math.max(0, await writeLines(sb, { table, id, entity, supplierId: row.supplier_id, docDate: row.document_date, docRef: row[docNoCol] || null, lines: lc.keep }));
        if (row.supplier_id) matched = await matchForSupplier(sb, entity, row.supplier_id).catch(() => null);
      }
      return NextResponse.json({ ok: true, entity, lines, matched });
    }

    if (action === "ack_flag") {
      const flag = String(b?.flag || "");
      if (!ACKABLE.has(flag)) return NextResponse.json({ ok: false, error: "that flag can't be acknowledged — fix the document instead" }, { status: 400 });
      if (!flags.includes(flag)) return NextResponse.json({ ok: false, error: "flag not on this row" }, { status: 409 });
      if (note.length < 5) return NextResponse.json({ ok: false, error: "say why it's correct (note)" }, { status: 400 });
      const rest = flags.filter((f) => f !== flag);
      const patch: Record<string, unknown> = { flags: rest, triage_log: stamp({ flag, note }) };
      if (row.match_status === "needs_triage" && !rest.some((f) => ["entity_guessed", "low_confidence"].includes(f))) patch.match_status = "unmatched";
      const { error } = await sb.from(table).update(patch).eq("id", id);
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true, flags: rest });
    }

    if (action === "ack_supplier") {
      if (!row.supplier_id) return NextResponse.json({ ok: false, error: "no supplier on this row" }, { status: 409 });
      const job = supabaseJob();
      const { data: sup } = await job.from("controller_suppliers").select("notes").eq("id", row.supplier_id).maybeSingle();
      const notes = String((sup as any)?.notes || "");
      if (!/— review$/.test(notes)) return NextResponse.json({ ok: true, already: true });
      await job.from("controller_suppliers").update({ notes: notes.replace(/— review$/, `— reviewed ${new Date().toISOString().slice(0, 10)}`) }).eq("id", row.supplier_id);
      await sb.from(table).update({ triage_log: stamp({ supplier_id: row.supplier_id, note }) }).eq("id", id);
      return NextResponse.json({ ok: true });
    }

    if (action === "reject") {
      if (note.length < 3) return NextResponse.json({ ok: false, error: "note required" }, { status: 400 });
      const { error } = await sb.from(table).update({ match_status: "rejected", triage_log: stamp({ note }) }).eq("id", id);
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
