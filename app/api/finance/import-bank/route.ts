import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

const ENTITY_OK = new Set(["IFL", "BM", "BBH"]);
// CaixaBank export columns (common variants) → our schema fields
const ALIASES: Record<string, string> = {
  "fecha": "date", "fecha operación": "date", "fecha operacion": "date", "fecha valor": "date", "date": "date",
  "concepto": "description", "descripción": "description", "descripcion": "description", "description": "description",
  "importe": "amount", "importe (€)": "amount", "amount": "amount",
  "saldo": "balance", "balance": "balance",
};
const norm = (s: any) => ALIASES[String(s || "").trim().toLowerCase()] || String(s || "").toLowerCase();
const num = (v: any) => { const n = typeof v === "number" ? v : Number(String(v || "").replace(/\./g,"").replace(",", ".")); return Number.isFinite(n) ? n : 0; };

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file"); const entity = String(form.get("entity") || "").toUpperCase(); const bankAccount = String(form.get("bank_account") || "CaixaBank");
    if (!(file instanceof Blob)) return NextResponse.json({ ok: false, error: "no file" }, { status: 400 });
    if (!ENTITY_OK.has(entity)) return NextResponse.json({ ok: false, error: "entity required (IFL/BM/BBH)" }, { status: 400 });

    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array", cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const raw: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" });
    if (raw.length < 2) return NextResponse.json({ ok: false, error: "empty file" }, { status: 400 });

    // Find header row (CaixaBank exports often have 5-10 lines of preamble)
    let headerRow = 0;
    for (let i = 0; i < Math.min(20, raw.length); i++) {
      const norms = (raw[i] || []).map(norm);
      if (norms.includes("date") && norms.includes("amount")) { headerRow = i; break; }
    }
    const headers = raw[headerRow].map(norm);
    const idx = (k: string) => headers.indexOf(k);

    const rows: any[] = [];
    for (let i = headerRow + 1; i < raw.length; i++) {
      const r = raw[i]; if (!r?.length) continue;
      const dc = r[idx("date")]; if (!dc) continue;
      const date = dc instanceof Date ? dc.toISOString().slice(0,10) : String(dc).slice(0,10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const amount = num(r[idx("amount")]);
      const desc = String(r[idx("description")] || "").trim();
      if (amount === 0 && !desc) continue;
      rows.push({
        entity_id: entity, bank_account: bankAccount, movement_date: date,
        amount_eur: amount, description: desc || "(no concept)",
        reconciled_to: "unmatched",
      });
    }
    if (!rows.length) return NextResponse.json({ ok: false, error: "no movement rows parsed — check the CaixaBank export headers" }, { status: 400 });

    const sb = supabaseServer();
    const { error } = await sb.from("bank_movements").insert(rows);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, inserted: rows.length, entity, bank_account: bankAccount });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
