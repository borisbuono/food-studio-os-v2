import { NextRequest, NextResponse } from "next/server";
import { parseFrestoXlsx } from "@/lib/integrations/pos/fresto";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof Blob)) return NextResponse.json({ ok: false, error: "no file" }, { status: 400 });
    const buf = await file.arrayBuffer();
    const rows = parseFrestoXlsx(buf);
    if (!rows.length) return NextResponse.json({ ok: false, error: "no rows parsed — check the Fresto export headers (date, food, wine, bar, softdrinks, tips, total, covers)" }, { status: 400 });
    return NextResponse.json({ ok: true, rows });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
