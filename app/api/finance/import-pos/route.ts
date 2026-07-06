import { NextRequest, NextResponse } from "next/server";
import { getPosAdapter } from "@/lib/integrations/registry";
import { persistFrestoRowToPos } from "@/lib/integrations/pos/fresto";
import { supabaseServer } from "@/lib/supabaseServer";
import type { EntityCode } from "@/lib/integrations/types";

export const runtime = "nodejs";

// POST — parses a Fresto XLSX/CSV upload AND, if restaurant_id is supplied, persists each row
// to the immutable eod_pos table. Returns the flat row shape used by /eod/new + the eod_pos ids.
// See memory/pos_vs_accounting_separation.md.
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    const entity = (form.get("entity") as string || "IFL").toUpperCase() as EntityCode;
    const restaurant_id = (form.get("restaurant_id") as string) || "";
    if (!(file instanceof Blob)) return NextResponse.json({ ok: false, error: "no file" }, { status: 400 });

    const adapter = getPosAdapter(entity);
    if (!adapter.parseUpload) return NextResponse.json({ ok: false, error: `${adapter.name} adapter has no upload parser — fallback to CSV import` }, { status: 400 });

    const buf = await file.arrayBuffer();
    const rows = await adapter.parseUpload(buf);
    if (!rows.length) return NextResponse.json({ ok: false, error: "no rows parsed — check the export headers (date, food, wine, bar, softdrinks, tips, total, covers)" }, { status: 400 });

    // Flat shape for the /eod/new UI
    const flat = rows.map((r) => ({
      date: r.date, covers: r.covers, total: r.total_eur,
      food: r.lines.find((l) => l.group === "food")?.net_eur || 0,
      wine: r.lines.find((l) => l.group === "wine")?.net_eur || 0,
      bar:  r.lines.find((l) => l.group === "bar")?.net_eur  || 0,
      softdrinks: r.lines.find((l) => l.group === "softdrinks")?.net_eur || 0,
      tips: r.lines.find((l) => l.group === "tips")?.net_eur || 0,
    }));

    // Persist each row to eod_pos (Fresto only for now — other adapters use their own path).
    // Idempotent per (restaurant_id, date, source).
    let persisted: { date: string; eod_pos_id: string; existed: boolean }[] = [];
    if (restaurant_id && adapter.vendor === "fresto") {
      const sb = supabaseServer();
      const { data: userRes } = await sb.auth.getUser();
      const uid = userRes?.user?.id || null;
      for (const r of flat) {
        try {
          const res = await persistFrestoRowToPos({
            restaurant_id,
            row: { ...r, cash: 0, card: 0 } as any,
            source_ref: (file as any)?.name || "fresto-xlsx-upload",
            imported_by: uid,
          });
          persisted.push({ date: r.date, eod_pos_id: res.id, existed: res.existed });
        } catch (e: any) {
          // Continue — the parse worked, only persistence failed for this row.
          persisted.push({ date: r.date, eod_pos_id: "", existed: false });
        }
      }
    }

    return NextResponse.json({ ok: true, adapter: adapter.name, vendor: adapter.vendor, rows: flat, persisted });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
