import { NextRequest, NextResponse } from "next/server";
import { getEntityCredential } from "@/lib/integrations/credentials";
import type { EntityCode } from "@/lib/integrations/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/grow/reach/ads/insights?entity=BM
//
// Wraps Meta Marketing API /act_{id}/insights with time_increment=1 for the
// last 90 days. Returns rows shaped for the AdsInsightsChart component:
//   { date, spend, reach }[]
//
// Read-only. No writes. Falls back to an empty rows array when Meta returns
// nothing (a disabled account still returns 200 with `data: []`).

const BASE = "https://graph.facebook.com/v20.0";
const ENTITY_ACCOUNT: Record<EntityCode, string | undefined> = {
  IFL: process.env.META_AD_ACCOUNT_IFL,
  BM:  process.env.META_AD_ACCOUNT_BM || "605781129956113",
  BBH: process.env.META_AD_ACCOUNT_BBH,
};

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const entity = (url.searchParams.get("entity") || "").toUpperCase() as EntityCode;
  if (!["IFL", "BM", "BBH"].includes(entity)) {
    return NextResponse.json({ ok: false, error: "entity must be IFL / BM / BBH" }, { status: 400 });
  }
  const acct = ENTITY_ACCOUNT[entity];
  if (!acct) return NextResponse.json({ ok: false, error: `no Meta account id for ${entity}` }, { status: 400 });
  const token = await getEntityCredential(entity, "meta-ads");
  if (!token) return NextResponse.json({ ok: true, rows: [] });

  const qs = new URLSearchParams({
    fields: "spend,reach,date_start",
    date_preset: "last_90d",
    time_increment: "1",
    access_token: token,
  });
  try {
    const r = await fetch(`${BASE}/act_${acct}/insights?${qs.toString()}`);
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      return NextResponse.json({ ok: false, error: `${r.status}: ${t.slice(0, 200)}` }, { status: 502 });
    }
    const j: any = await r.json().catch(() => ({}));
    const rows = Array.isArray(j?.data) ? j.data : [];
    const shaped = rows.map((row: any) => ({
      date: String(row.date_start || ""),
      spend: row.spend != null ? Number(row.spend) : null,
      reach: row.reach != null ? Number(row.reach) : null,
    }));
    return NextResponse.json({ ok: true, rows: shaped });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 502 });
  }
}
