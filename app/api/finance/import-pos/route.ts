import { NextRequest, NextResponse } from "next/server";
import { getPosAdapter } from "@/lib/integrations/registry";
import type { EntityCode } from "@/lib/integrations/types";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    const entity = (form.get("entity") as string || "IFL").toUpperCase() as EntityCode;
    if (!(file instanceof Blob)) return NextResponse.json({ ok: false, error: "no file" }, { status: 400 });

    const adapter = getPosAdapter(entity);
    if (!adapter.parseUpload) return NextResponse.json({ ok: false, error: `${adapter.name} adapter has no upload parser — fallback to CSV import` }, { status: 400 });

    const buf = await file.arrayBuffer();
    const rows = await adapter.parseUpload(buf);
    if (!rows.length) return NextResponse.json({ ok: false, error: "no rows parsed — check the export headers (date, food, wine, bar, softdrinks, tips, total, covers)" }, { status: 400 });

    // Flatten back to the simple row shape used by /eod/new
    const flat = rows.map((r) => ({
      date: r.date, covers: r.covers, total: r.total_eur,
      food: r.lines.find((l) => l.group === "food")?.net_eur || 0,
      wine: r.lines.find((l) => l.group === "wine")?.net_eur || 0,
      bar:  r.lines.find((l) => l.group === "bar")?.net_eur  || 0,
      softdrinks: r.lines.find((l) => l.group === "softdrinks")?.net_eur || 0,
      tips: r.lines.find((l) => l.group === "tips")?.net_eur || 0,
    }));
    return NextResponse.json({ ok: true, adapter: adapter.name, vendor: adapter.vendor, rows: flat });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
