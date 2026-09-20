import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/prep/list/generate
//   body { entity_id, service_date, target_covers? }
//   → materialise active templates whose applies_days_of_week (0=Sun … 6=Sat)
//     matches the service_date's weekday into prep_lists rows.
//     Duplicate name+station rows already present for the day are skipped
//     so re-running the generator is safe.

function isUuid(x: any): x is string {
  return typeof x === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
}
function isIsoDate(x: any): x is string {
  return typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x);
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const entity_id: string = body?.entity_id;
  const service_date: string = body?.service_date;
  const target_covers: number | null =
    typeof body?.target_covers === "number" && Number.isFinite(body.target_covers) ? body.target_covers : null;

  if (!isUuid(entity_id)) return Response.json({ ok: false, error: "entity_id uuid required" }, { status: 400 });
  if (!isIsoDate(service_date)) return Response.json({ ok: false, error: "service_date YYYY-MM-DD required" }, { status: 400 });

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return Response.json({ ok: false, error: "not authenticated" }, { status: 401 });

  // Derive weekday ONCE from the service_date. UTC parsing is deterministic;
  // the caller passes the trading date they intend so we never re-guess it.
  const dow = new Date(service_date + "T00:00:00Z").getUTCDay(); // 0=Sun

  const { data: templates, error: tErr } = await sb
    .from("prep_templates")
    .select("id, entity_id, name, station, active, applies_days_of_week")
    .eq("entity_id", entity_id)
    .eq("active", true);
  if (tErr) return Response.json({ ok: false, error: tErr.message }, { status: 500 });

  const eligible = (templates || []).filter((t: any) => {
    const days: number[] | null = t.applies_days_of_week;
    if (!days || days.length === 0) return true; // no restriction → every day
    return days.includes(dow);
  });

  if (eligible.length === 0) {
    return Response.json({ ok: true, inserted: 0, skipped: 0, templates: 0 });
  }

  const templateIds = eligible.map((t: any) => t.id);
  const { data: items, error: iErr } = await sb
    .from("prep_template_items")
    .select("*")
    .in("template_id", templateIds)
    .order("sort_order", { ascending: true });
  if (iErr) return Response.json({ ok: false, error: iErr.message }, { status: 500 });

  // Existing prep_lists for the day (idempotency key = station + name)
  const { data: existing, error: eErr } = await sb
    .from("prep_lists")
    .select("station, name")
    .eq("entity_id", entity_id)
    .eq("service_date", service_date);
  if (eErr) return Response.json({ ok: false, error: eErr.message }, { status: 500 });

  const seen = new Set(
    (existing || []).map((r: any) => `${(r.station ?? "").toLowerCase()}::${(r.name ?? "").toLowerCase()}`),
  );

  const templateById = new Map(eligible.map((t: any) => [t.id, t]));
  const rowsToInsert: any[] = [];
  let skipped = 0;

  for (const it of items || []) {
    const tmpl: any = templateById.get(it.template_id);
    const station: string | null = (it.station ?? tmpl?.station) ?? null;
    const key = `${(station ?? "").toLowerCase()}::${(it.name ?? "").toLowerCase()}`;
    if (seen.has(key)) { skipped++; continue; }
    seen.add(key);

    // per_cover × target_covers wins over the template's flat quantity
    // when both a per-cover ratio and a covers forecast are present.
    let qty = it.quantity ?? null;
    if (it.per_cover != null && target_covers != null) {
      qty = Number((it.per_cover * target_covers).toFixed(3));
    }

    rowsToInsert.push({
      entity_id,
      service_date,
      station,
      name: it.name,
      quantity: qty,
      unit: it.unit ?? null,
      per_cover: it.per_cover ?? null,
      target_covers,
      status: "todo",
    });
  }

  if (rowsToInsert.length === 0) {
    return Response.json({ ok: true, inserted: 0, skipped, templates: eligible.length });
  }

  const { data: inserted, error: insErr } = await sb.from("prep_lists").insert(rowsToInsert).select("id");
  if (insErr) return Response.json({ ok: false, error: insErr.message }, { status: 500 });

  return Response.json({
    ok: true,
    inserted: (inserted || []).length,
    skipped,
    templates: eligible.length,
  });
}
