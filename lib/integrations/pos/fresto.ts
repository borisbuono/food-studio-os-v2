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
  efectivo: "cash", cash: "cash",
  tarjeta: "card", card: "card",
};

function normalizeHeader(h: any): string {
  return HEADER_ALIASES[String(h || "").trim().toLowerCase()] || String(h || "").toLowerCase();
}

export function parseFrestoXlsx(buf: ArrayBuffer): { date: string; covers: number; food: number; wine: number; bar: number; softdrinks: number; tips: number; total: number; cash: number; card: number }[] {
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
      const j = idx(k); if (j < 0) return 0;
      const v = row[j];
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
      cash: num("cash"),
      card: num("card"),
    });
  }
  return out;
}

// Persist a parsed Fresto row to eod_pos (immutable POS snapshot). Idempotent per
// (restaurant_id, date, source) — re-uploads for the same day return the existing row.
// Returns the eod_pos id so the caller can chain into /api/finance/eod/create-accounting-from-pos.
export async function persistFrestoRowToPos(params: {
  restaurant_id: string;
  row: ReturnType<typeof parseFrestoXlsx>[number];
  source_ref?: string | null;
  imported_by?: string | null;
}): Promise<{ id: string; existed: boolean }> {
  const { supabaseServer } = await import("@/lib/supabaseServer");
  const sb = supabaseServer();
  const { row } = params;
  // Try to find an existing snapshot for the day+source first (immutable — do NOT overwrite).
  const found = await sb.from("eod_pos")
    .select("id")
    .eq("restaurant_id", params.restaurant_id)
    .eq("date", row.date)
    .eq("source", "fresto")
    .maybeSingle();
  if (found.data?.id) return { id: found.data.id, existed: true };

  const ins = await sb.from("eod_pos").insert({
    restaurant_id: params.restaurant_id,
    date: row.date,
    source: "fresto",
    source_ref: params.source_ref || null,
    covers: row.covers || 0,
    food_net_eur: row.food || 0,
    wine_net_eur: row.wine || 0,
    bar_net_eur: row.bar || 0,
    softdrinks_net_eur: row.softdrinks || 0,
    tips_eur: row.tips || 0,
    service_charge_eur: 0,
    cash_declared_eur: row.cash || 0,
    card_declared_eur: row.card || 0,
    total_gross_eur: row.total || 0,
    imported_by: params.imported_by || null,
    raw_payload: row as any,
  }).select("id").single();
  if (ins.error) throw new Error("eod_pos insert failed: " + ins.error.message);
  return { id: ins.data.id, existed: false };
}

// PosAdapter for Fresto. parseUpload returns the substrate-agnostic shape. The API route
// wraps this with persistFrestoRowToPos to land the immutable snapshot.

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
    // Reads the immutable POS snapshot for the day. Post EOD split (2026-07-05): eod_pos is
    // the truth for what Fresto rang up. eod_accounting is what Boris booked.
    const { supabaseServer } = await import("@/lib/supabaseServer");
    const sb = supabaseServer();
    const { data } = await sb.from("eod_pos")
      .select("food_net_eur,wine_net_eur,bar_net_eur,softdrinks_net_eur,tips_eur,total_gross_eur,covers")
      .eq("restaurant_id", restaurant_id)
      .eq("date", date)
      .eq("source", "fresto")
      .maybeSingle();
    if (!data) return null;
    const lines: PosSaleLine[] = [
      { group: "food",       net_eur: Number(data.food_net_eur       || 0), vat_rate: 10, vat_eur: Number(data.food_net_eur       || 0) * 0.10 },
      { group: "wine",       net_eur: Number(data.wine_net_eur       || 0), vat_rate: 10, vat_eur: Number(data.wine_net_eur       || 0) * 0.10 },
      { group: "bar",        net_eur: Number(data.bar_net_eur        || 0), vat_rate: 10, vat_eur: Number(data.bar_net_eur        || 0) * 0.10 },
      { group: "softdrinks", net_eur: Number(data.softdrinks_net_eur || 0), vat_rate: 10, vat_eur: Number(data.softdrinks_net_eur || 0) * 0.10 },
      { group: "tips",       net_eur: Number(data.tips_eur           || 0), vat_rate: 0,  vat_eur: 0 },
    ];
    return {
      date,
      restaurant_id,
      covers: Number(data.covers || 0),
      lines,
      total_eur: Number(data.total_gross_eur || 0),
      source: { adapter: "fresto", raw_ref: "eod_pos" },
    };
  },
};
