import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { serverEntity } from "@/lib/serverVenue";

export const runtime = "nodejs";

const ENTITY_CODE: Record<string, string> = { utopia: "IFL", taller: "IFL", bistro_mondo: "BM", holdings: "BBH" };

export async function POST(req: NextRequest) {
  try {
    const sb = supabaseServer();
    const ent = ENTITY_CODE[serverEntity()] || "IFL";
    const form = await req.formData();
    const file = form.get("file");
    const type = String(form.get("type") || "invoice");
    if (!(file instanceof Blob)) return NextResponse.json({ ok: false, error: "no file" }, { status: 400 });

    const ext = (file as any).name?.split(".").pop()?.toLowerCase() || "jpg";
    const ts = Date.now();
    const path = `${ent}/${type}/${ts}.${ext}`;

    const buf = await file.arrayBuffer();
    const up = await sb.storage.from("captures").upload(path, buf, { contentType: (file as any).type || "image/jpeg" });
    if (up.error) return NextResponse.json({ ok: false, error: "storage: " + up.error.message }, { status: 500 });
    const signed = await sb.storage.from("captures").createSignedUrl(path, 60 * 60 * 24 * 30); // 30d signed URL
    const doc_url = signed.data?.signedUrl || null;

    if (type === "invoice" || type === "other") {
      const { data } = await sb.from("invoice_inbox").insert({
        entity_id: ent,
        source: "paper_photo",
        arrived_at: new Date().toISOString(),
        doc_url,
        match_status: "needs_triage",
        notes: type === "other" ? "captured via /capture — other" : "captured via /capture",
      }).select("id").maybeSingle();
      return NextResponse.json({ ok: true, type, id: data?.id, where: "invoice_inbox", next: "/administrate/finance/scans" });
    }
    if (type === "albaran") {
      const { data } = await sb.from("albarans").insert({
        entity_id: ent,
        received_at: new Date().toISOString(),
        photo_url: doc_url,
        match_status: "drop_in",
        notes: "captured via /capture — drop-in delivery note",
      }).select("id").maybeSingle();
      return NextResponse.json({ ok: true, type, id: data?.id, where: "albarans", next: "/execute/receiving" });
    }
    if (type === "eod") {
      // EOD photos park in invoice_inbox tagged so the user can transcribe them on /eod/new
      const { data } = await sb.from("invoice_inbox").insert({
        entity_id: ent,
        source: "paper_photo",
        arrived_at: new Date().toISOString(),
        doc_url,
        match_status: "needs_triage",
        notes: "EOD photo — transcribe at /administrate/finance/eod/new",
      }).select("id").maybeSingle();
      return NextResponse.json({ ok: true, type, id: data?.id, where: "EOD intake", next: "/administrate/finance/eod/new" });
    }
    return NextResponse.json({ ok: false, error: "unknown type" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
