import * as XLSX from "xlsx";
import type { PosAdapter, PosDailySale, PosSaleLine } from "@/lib/integrations/types";

// Fresto export shape (current — XLSX from the operator dashboard):
// columns: date | food | wine | bar | softdrinks | tips | total
// One row per day. Headers are normalized lowercase for resilient parsing.

const HEADER_ALIASES: Record<string, string> = {
  fecha: "date", day: "date", date: "date",
  comida: "food", food: "food", "food sales": "food",
  vino: "wine", wine: "wine",
  bar: "bar", barra: "bar", "alcohol": "bar",
  refresco: "softdrinks", refrescos: "softdrinks", soft: "softdrinks", softdrinks: "softdrinks", "soft drinks": "softdrinks",
  propinas: "tips", tips: "tips", tip: "tips",
  total: "total",
  cubiertos: "covers", covers: "covers",
};

function normalizeHeader(h: any): string {
  return HEADER_ALIASES[String(h || "").trim().toLowerCase()] || String(h || "").toLowerCase();
}

export function parseFrestoXlsx(buf: ArrayBuffer): { date: string; covers: number; food: number; wine: number; bar: number; softdrinks: number; tips: number; total: number }[] {
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const raw: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" });
  if (raw.length < 2) return [];

  const headers = raw[0].map(normalizeHeader);
  const idx = (k: string) => headers.indexOf(k);
  const out: any[] = [];
  for (let i = 1; i < raw.length; i++) {
    const row = raw[i];
    if (!row || !row.length) continue;
    const dateCell = row[idx("date")];
    if (!dateCell) continue;
    const date = dateCell instanceof Date ? dateCell.toISOString().slice(0, 10) : String(dateCell).slice(0, 10);
    const num = (k: string) => {
      const v = row[idx(k)];
      const n = typeof v === "number" ? v : Number(String(v || "").replace(",", "."));
      return Number.isFinite(n) ? n : 0;
    };
    out.push({
      date,
      covers: Math.round(num("covers")),
      food: num("food"),
      wine: num("wine"),
      bar: num("bar"),
      softdrinks: num("softdrinks"),
      tips: num("tips"),
      total: num("total"),
    });
  }
  return out;
}

// PosAdapter for Fresto. pullDay reads from an upload-cached map keyed by restaurant_id:
// in v1 the Fresto API isn't connected yet, so the adapter is fed by /api/pos/import upload.
// Once Lars's API lands, pullDay calls the live endpoint instead.

export const frestoAdapter: PosAdapter = {
  name: "Fresto",
  vendor: "fresto",
  async parseUpload(buf: ArrayBuffer): Promise<PosDailySale[]> {
    const rows = parseFrestoXlsx(buf);
    return rows.map((r) => ({
      date: r.date,
      restaurant_id: "",
      covers: r.covers,
      lines: [
        { group: "food", net_eur: r.food, vat_rate: 10, vat_eur: r.food * 0.10 },
        { group: "wine", net_eur: r.wine, vat_rate: 10, vat_eur: r.wine * 0.10 },
        { group: "bar",  net_eur: r.bar,  vat_rate: 10, vat_eur: r.bar  * 0.10 },
        { group: "softdrinks", net_eur: r.softdrinks, vat_rate: 10, vat_eur: r.softdrinks * 0.10 },
        { group: "tips", net_eur: r.tips, vat_rate: 0, vat_eur: 0 },
      ],
      total_eur: r.total,
      source: { adapter: "fresto" },
    }));
  },
  async pullDay(restaurant_id: string, date: string): Promise<PosDailySale | null> {
    // v1: data comes via upload, parsed and persisted by /api/pos/import into eod_reports.
    // pullDay just reads back the eod_reports row.
    const { supabaseServer } = await import("@/lib/supabaseServer");
    const sb = supabaseServer();
    const { data } = await sb.from("eod_reports").select("revenue,revenue_food,revenue_wine,revenue_bar,actual_covers").eq("restaurant_id", restaurant_id).eq("report_date", date).maybeSingle();
    if (!data) return null;
    const lines: PosSaleLine[] = [
      { group: "food", net_eur: Number(data.revenue_food || 0), vat_rate: 10, vat_eur: Number(data.revenue_food || 0) * 0.10 },
      { group: "wine", net_eur: Number(data.revenue_wine || 0), vat_rate: 10, vat_eur: Number(data.revenue_wine || 0) * 0.10 },
      { group: "bar",  net_eur: Number(data.revenue_bar  || 0), vat_rate: 10, vat_eur: Number(data.revenue_bar  || 0) * 0.10 },
    ];
    return {
      date,
      restaurant_id,
      covers: Number(data.actual_covers || 0),
      lines,
      total_eur: Number(data.revenue || 0),
      source: { adapter: "fresto", raw_ref: "eod-cache" },
    };
  },
};
