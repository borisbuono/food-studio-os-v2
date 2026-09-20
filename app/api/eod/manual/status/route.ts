import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { ENTITY_TO_RESTAURANT, isPrimaryEntity, EntityKey } from "@/lib/entities";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/eod/manual/status?entity=<uuid>&days=<n>
//   Returns the list of dates in the last <days> (default 30, cap 90) for
//   which the entity has NO eod_pos row (any source). Used by the manual-
//   entry surface to prompt the operator to backfill missing days.

async function resolveRestaurantId(sb: ReturnType<typeof supabaseServer>, entityId: string): Promise<string | null> {
  if (isPrimaryEntity(entityId)) {
    const mapped = ENTITY_TO_RESTAURANT[entityId as EntityKey];
    if (mapped) return mapped;
  }
  const { data } = await sb
    .from("restaurants").select("id").eq("entity_id", entityId).limit(1).maybeSingle();
  return (data?.id as string) || null;
}

function madridToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

// derived_date_computed_once: today is derived here, then the window is
// generated from it — every downstream date compare uses the same base.
function windowDates(today: string, days: number): string[] {
  const out: string[] = [];
  // today at Madrid-noon UTC — pick noon to sidestep DST tomfoolery when we
  // step back one day at a time.
  const base = new Date(today + "T12:00:00Z");
  for (let i = 1; i <= days; i++) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export async function GET(req: NextRequest) {
  const sb = supabaseServer();
  const { data: userRes } = await sb.auth.getUser();
  const user = userRes?.user;
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const entityId = String(url.searchParams.get("entity") || "").trim();
  const daysRaw = Number(url.searchParams.get("days") || "30");
  const days = Math.max(1, Math.min(90, Number.isFinite(daysRaw) ? Math.floor(daysRaw) : 30));
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entityId)) {
    return NextResponse.json({ ok: false, error: "entity (uuid) required" }, { status: 400 });
  }

  const rid = await resolveRestaurantId(sb, entityId);
  if (!rid) return NextResponse.json({ ok: false, error: "no restaurant row for entity_id" }, { status: 400 });

  const today = madridToday();
  const window = windowDates(today, days);
  const earliest = window[window.length - 1];
  const latest = window[0];

  const { data: rows, error } = await sb
    .from("eod_pos")
    .select("date, source, total_gross_eur")
    .eq("restaurant_id", rid)
    .gte("date", earliest)
    .lte("date", latest)
    .order("date", { ascending: false });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const present = new Map<string, { source: string; total: number }>();
  for (const r of rows || []) {
    const d = String((r as any).date);
    if (!present.has(d)) present.set(d, { source: String((r as any).source), total: Number((r as any).total_gross_eur || 0) });
  }
  const missing = window.filter((d) => !present.has(d));

  return NextResponse.json({
    ok: true,
    entity_id: entityId,
    restaurant_id: rid,
    today,
    days,
    window: { from: earliest, to: latest },
    missing,
    present: Array.from(present.entries()).map(([date, v]) => ({ date, source: v.source, total_gross_eur: v.total })),
  });
}
