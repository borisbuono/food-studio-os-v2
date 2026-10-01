import { supabaseServer } from "@/lib/supabaseServer";
import { cleaningCaller } from "@/lib/cleaning/auth";
import { isUuid, loadRuns } from "@/lib/cleaning/server";
import { buildRegisterPdf, monthBounds } from "@/lib/cleaning/register";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/cleaning/export?entity=<uuid>&month=YYYY-MM&area=<text?>
//   → one PDF for the month: black text, black hairlines, bare paper — the
//     Sanidad-style register (summary table + every list with who/when and the
//     responsible person's sign-off). Members of the entity.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const entity = url.searchParams.get("entity");
  const month = String(url.searchParams.get("month") || "");
  const area = url.searchParams.get("area") || null;
  if (!isUuid(entity)) return Response.json({ ok: false, error: "entity uuid required" }, { status: 400 });
  const b = monthBounds(month);
  if (!b) return Response.json({ ok: false, error: "month YYYY-MM required" }, { status: 400 });
  const who = await cleaningCaller(entity);
  if (!who.ok) return Response.json({ ok: false, error: who.error }, { status: who.status });
  const sb = supabaseServer();
  const { data: e } = await sb.from("entities").select("name, legal_name, slug, timezone").eq("id", entity).maybeSingle();
  if (!e) return Response.json({ ok: false, error: "unknown entity" }, { status: 404 });
  try {
    const runs = await loadRuns(sb, entity, b.from, b.to, { area });
    const pdf = buildRegisterPdf({ entityName: (e as any).name, legalName: (e as any).legal_name, month, area, tz: (e as any).timezone || "Europe/Madrid", runs });
    const fname = `Limpieza_${(e as any).slug || "house"}_${month}${area ? "_" + String(area).replace(/[^a-z0-9]+/gi, "-") : ""}.pdf`;
    return new Response(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${fname}"`, "cache-control": "no-store" } });
  } catch (err: any) { return Response.json({ ok: false, error: String(err?.message || err) }, { status: 500 }); }
}
