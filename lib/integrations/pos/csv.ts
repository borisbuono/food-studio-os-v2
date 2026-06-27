import * as XLSX from "xlsx";
import type { PosAdapter, PosDailySale, PosSaleLine } from "@/lib/integrations/types";

// Generic CSV/XLSX POS adapter. Same header aliases as Fresto plus a few more for Square/Toast exports.
const ALIASES: Record<string, string> = {
  fecha: "date", day: "date", date: "date", "business date": "date",
  comida: "food", food: "food", "food sales": "food", entrees: "food",
  vino: "wine", wine: "wine", wines: "wine",
  bar: "bar", barra: "bar", spirits: "bar", "bar sales": "bar",
  refresco: "softdrinks", softdrinks: "softdrinks", "soft drinks": "softdrinks", "n/a beverage": "softdrinks",
  propinas: "tips", tips: "tips", gratuity: "tips",
  cubiertos: "covers", covers: "covers", guests: "covers",
  total: "total",
};
const norm = (h: any) => ALIASES[String(h || "").trim().toLowerCase()] || String(h || "").toLowerCase();
const num = (v: any) => { const n = typeof v === "number" ? v : Number(String(v || "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };

export const csvAdapter: PosAdapter = {
  name: "Generic CSV/XLSX",
  vendor: "csv",
  async pullDay() { return null; },
  async parseUpload(buf: ArrayBuffer): Promise<PosDailySale[]> {
    const wb = XLSX.read(buf, { type: "array", cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const raw: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" });
    if (raw.length < 2) return [];
    const headers = raw[0].map(norm);
    const idx = (k: string) => headers.indexOf(k);
    const out: PosDailySale[] = [];
    for (let i = 1; i < raw.length; i++) {
      const row = raw[i]; if (!row?.length) continue;
      const dc = row[idx("date")]; if (!dc) continue;
      const date = dc instanceof Date ? dc.toISOString().slice(0, 10) : String(dc).slice(0, 10);
      const food = num(row[idx("food")]); const wine = num(row[idx("wine")]);
      const bar  = num(row[idx("bar")]);  const soft = num(row[idx("softdrinks")]);
      const tips = num(row[idx("tips")]); const covers = Math.round(num(row[idx("covers")]));
      const lines: PosSaleLine[] = [
        { group: "food", net_eur: food, vat_rate: 10, vat_eur: food * 0.10 },
        { group: "wine", net_eur: wine, vat_rate: 10, vat_eur: wine * 0.10 },
        { group: "bar",  net_eur: bar,  vat_rate: 10, vat_eur: bar  * 0.10 },
        { group: "softdrinks", net_eur: soft, vat_rate: 10, vat_eur: soft * 0.10 },
        { group: "tips", net_eur: tips, vat_rate: 0,  vat_eur: 0 },
      ];
      const total = num(row[idx("total")]) || (food + wine + bar + soft + tips);
      out.push({ date, restaurant_id: "", covers, lines, total_eur: total, source: { adapter: "csv" } });
    }
    return out;
  },
};
