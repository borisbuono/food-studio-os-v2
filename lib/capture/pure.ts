// Capture funnel — pure logic. No imports, no I/O, so it can be tested with
// plain node (see tests/capture-funnel.test.ts) and reused by every route.
//
// Rules this file encodes (26-09-2026 CEO conditions + BUILD_PROMPT_document_funnel):
//   1. Entity comes from the addressee printed on the paper, never the session.
//   2. VAT is stored per rate band; vat_eur is only the sum.
//   3. Every line must satisfy qty × price × (1 − disc/100) ≈ line subtotal.
//   4. Dedup on (supplier CIF + doc number + total); same number + different
//      total is a conflict, not a duplicate.
//   5. Many albaranes → one invoice only when exactly one subset reconciles.

export type EntityCode = "BM" | "IFL" | "BBH" | "UTOPIA";

// ── identifiers ──────────────────────────────────────────────────────────
// "ES B-13.659.594" → "B13659594". Spanish NIF/CIF and EU VAT ids.
export function normTaxId(v: string | null | undefined): string | null {
  if (!v) return null;
  let t = String(v).toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (/^ES[A-Z0-9]{9}$/.test(t)) t = t.slice(2);
  return t.length >= 8 ? t : null;
}

// Doc numbers: strip ALL whitespace and separators so "CF1F 27082" ==
// "CF1F27082" and "FVA/7734" == "FVA 7734" ([[dedup_keys_must_strip_internal_whitespace]]).
export function normDocNo(v: string | null | undefined): string | null {
  if (!v) return null;
  const t = String(v).toUpperCase().replace(/[^A-Z0-9]/g, "");
  return t || null;
}

export function normName(v: string | null | undefined): string {
  return String(v || "")
    .toUpperCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\b(S\.?\s?L\.?\s?U?\.?|S\.?\s?A\.?|SOCIEDAD LIMITADA|UNIPERSONAL)\b/g, " ")
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ── entity from the document ─────────────────────────────────────────────
export type OwnEntity = { code: EntityCode; tax_id: string | null; legal_name: string | null };
export type EntityVerdict =
  | { kind: "document"; code: EntityCode; by: "cif" | "name" }
  | { kind: "third_party"; addressee: string }     // addressed to someone else → reject
  | { kind: "unknown"; reason: string };            // guess from session, flag needs_triage

export function resolveEntityFromDoc(
  addressee: { vat_id?: string | null; name?: string | null },
  own: OwnEntity[],
): EntityVerdict {
  const cif = normTaxId(addressee.vat_id);
  if (cif) {
    const hit = own.find((e) => normTaxId(e.tax_id) === cif);
    if (hit) return { kind: "document", code: hit.code, by: "cif" };
  }
  const nm = normName(addressee.name);
  if (nm) {
    const hit = own.find((e) => e.legal_name && nm.includes(normName(e.legal_name)));
    if (hit) {
      // Name matched but the printed CIF is a different one (e.g. B57481517 on
      // old BM paper) — never trust the name over a contradicting CIF.
      if (cif && normTaxId(hit.tax_id) && normTaxId(hit.tax_id) !== cif) {
        return { kind: "unknown", reason: `name ${hit.code} but CIF ${cif} matches no entity` };
      }
      return { kind: "document", code: hit.code, by: "name" };
    }
  }
  if (cif) return { kind: "third_party", addressee: `${addressee.name || "?"} (${cif})` };
  if (nm && nm.length > 3) return { kind: "third_party", addressee: String(addressee.name) };
  return { kind: "unknown", reason: "no addressee readable" };
}

// ── money ────────────────────────────────────────────────────────────────
export const r2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;
export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let t = String(v).trim().replace(/[€\s]/g, "");
  // "1.234,56" → 1234.56 ; "12,34" → 12.34
  if (/,\d{1,3}$/.test(t)) t = t.replace(/\./g, "").replace(",", ".");
  const x = Number(t);
  return Number.isFinite(x) ? x : null;
}

// Every tax line a Spanish or foreign supplier can print. One band per
// (regime, rate). `iva` is the default so old rows ({rate, base, cuota}) still read.
//   iva            IVA peninsular/Baleares — 0 · 2 · 4 · 5 · 7.5 · 10 · 12 · 21
//   iva_nd         IVA no deducible (the accountant's call, never inferred)
//   iva_bi         IVA bien de inversión
//   re             Recargo de equivalencia 0.5 · 0.62 · 1.4 · 1.75 · 5.2 (surcharge on the same base)
//   intra_goods    Adquisición intracomunitaria de bienes (EU supplier, 0 % printed, self-assessed)
//   intra_services Adquisición intracomunitaria de servicios
//   isp            Inversión del sujeto pasivo (domestic reverse charge)
//   import         Importación (IVA paid at customs / DUA)
//   exempt         Exento (art. 20 LIVA …)
//   not_subject    No sujeto
//   igic           Canarias 0 · 3 · 5 · 7 · 9.5 · 15 · 20
//   ipsi           Ceuta / Melilla
//   foreign_vat    another country's VAT (MwSt, TVA, IVA IT/PT …) — not deductible in Spain
//   retention      IRPF withheld (15 · 7 · 19 · 1 · 2 · 24 · 35) — reduces the total
export type TaxRegime =
  | "iva" | "iva_nd" | "iva_bi" | "re" | "intra_goods" | "intra_services" | "isp" | "import"
  | "exempt" | "not_subject" | "igic" | "ipsi" | "foreign_vat" | "retention";
export const TAX_REGIMES: TaxRegime[] = ["iva", "iva_nd", "iva_bi", "re", "intra_goods", "intra_services", "isp", "import", "exempt", "not_subject", "igic", "ipsi", "foreign_vat", "retention"];
export type VatBand = { rate: number; base: number; cuota: number; regime?: TaxRegime; country?: string | null };

const RATES: Record<TaxRegime, number[] | null> = {
  iva: [0, 2, 4, 5, 7.5, 10, 12, 21], iva_nd: [4, 5, 7.5, 10, 21], iva_bi: [4, 10, 21],
  re: [0.5, 0.62, 1.4, 1.75, 5.2], intra_goods: [0, 4, 10, 21], intra_services: [0, 4, 10, 21],
  isp: [4, 10, 21], import: [4, 10, 21], exempt: [0], not_subject: [0],
  igic: [0, 3, 5, 7, 9.5, 15, 20], ipsi: [0.5, 1, 2, 3, 4, 8, 10], foreign_vat: null,
  retention: [1, 2, 7, 15, 19, 24, 35],
};
// Self-assessed: the supplier prints 0 cuota; the 303 carries the Spanish rate on both sides.
const SELF_ASSESSED = new Set<TaxRegime>(["intra_goods", "intra_services", "isp"]);

export function regimeOf(v: unknown): TaxRegime {
  const t = String(v || "").toLowerCase().trim();
  return (TAX_REGIMES as string[]).includes(t) ? (t as TaxRegime) : "iva";
}

// EU VAT prefixes (Greece is EL). A supplier id starting with one of these,
// other than ES, is an EU supplier.
const EU = new Set(["AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "EL", "FI", "FR", "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK"]);
export function supplierCountry(vatId: string | null | undefined): { country: string | null; eu: boolean } {
  const t = String(vatId || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const pre = t.slice(0, 2);
  if (/^[A-Z]{2}/.test(pre) && pre !== "ES" && EU.has(pre)) return { country: pre, eu: true };
  if (/^(ES)?[A-Z0-9]\d{7}[A-Z0-9]$/.test(t)) return { country: "ES", eu: true };
  if (/^[A-Z]{2}/.test(pre) && !/^[A-HJ-NP-SUVW]\d/.test(t)) return { country: pre, eu: false };
  return { country: null, eu: false };
}

// Normalise bands: merge per (regime, rate), flag odd rates, cuota ≠ base × rate,
// and anything our Holded books can't take without the accountant.
export function normaliseBands(raw: unknown): { bands: VatBand[]; flags: string[] } {
  const flags: string[] = [];
  const by = new Map<string, VatBand>();
  for (const b of Array.isArray(raw) ? raw : []) {
    const regime = regimeOf((b as any)?.regime);
    const rate = num((b as any)?.rate);
    const base = num((b as any)?.base);
    let cuota = num((b as any)?.cuota);
    if (rate === null || base === null) continue;
    if (SELF_ASSESSED.has(regime) || regime === "exempt" || regime === "not_subject") cuota = cuota ?? 0;
    const k = `${regime}:${rate}`;
    const cur = by.get(k) || { regime, rate, base: 0, cuota: 0, country: (b as any)?.country || null };
    cur.base = r2(cur.base + base);
    cur.cuota = r2(cur.cuota + (cuota ?? r2((base * rate) / 100)));
    by.set(k, cur);
  }
  const bands = Array.from(by.values()).sort((a, b) => (a.regime || "").localeCompare(b.regime || "") || a.rate - b.rate);
  for (const b of bands) {
    const reg = b.regime || "iva";
    const allowed = RATES[reg];
    if (allowed && !allowed.includes(b.rate)) flags.push(`tax_rate_unusual_${reg}_${b.rate}`);
    const printedCuota = !SELF_ASSESSED.has(reg) && reg !== "exempt" && reg !== "not_subject";
    if (printedCuota && Math.abs(r2((b.base * b.rate) / 100) - Math.abs(b.cuota)) > 0.05) flags.push(`tax_cuota_mismatch_${reg}_${b.rate}`);
    if (reg === "igic" || reg === "ipsi" || reg === "foreign_vat" || reg === "re") flags.push("tax_regime_needs_accountant");
    if (SELF_ASSESSED.has(reg)) flags.push("self_assessed_vat");
    if (reg === "retention") flags.push("irpf_retention");
  }
  return { bands, flags: Array.from(new Set(flags)) };
}

// Totals as printed: bases once (a surcharge sits on an existing base),
// cuotas of taxes actually charged, minus IRPF withheld.
export function bandTotals(bands: VatBand[]) {
  let base = 0, vat = 0, retention = 0;
  for (const b of bands) {
    const reg = b.regime || "iva";
    if (reg === "retention") { retention += Math.abs(b.cuota); continue; }
    if (reg !== "re") base += b.base;
    if (!SELF_ASSESSED.has(reg)) vat += b.cuota;
  }
  base = r2(base); vat = r2(vat); retention = r2(retention);
  return { base, vat, retention, total: r2(base + vat - retention) };
}

// Holded purchase tax keys (live list, BM, 26-09-2026 — GET /taxes).
// null = no key in our books → the push is blocked for the accountant.
export function holdedTaxKey(b: VatBand, kind: "goods" | "services" = "goods"): string | null {
  const reg = b.regime || "iva";
  const r = b.rate === 7.5 ? "75" : String(b.rate);
  switch (reg) {
    case "iva": return [0, 2, 4, 5, 7.5, 10, 12, 21].includes(b.rate) ? `p_iva_${r}` : null;
    case "iva_nd": return [4, 5, 7.5, 10, 21].includes(b.rate) ? `p_iva_nd_${r}` : null;
    case "iva_bi": return [4, 10, 21].includes(b.rate) ? `p_iva_bi_${r}` : null;
    case "intra_goods": case "intra_services": {
      if (b.rate === 0) return "p_iva_adqintrabs_0";
      const g = reg === "intra_goods" || kind === "goods" ? "b" : "s";
      return [4, 10, 21].includes(b.rate) ? `p_iva_adqintra${reg === "intra_services" ? "s" : g}_${r}` : null;
    }
    case "isp": return b.rate === 21 ? "p_iva_invsuj" : [4, 10].includes(b.rate) ? `p_iva_invsuj_${r}` : null;
    case "import": return [4, 10, 21].includes(b.rate) ? `p_iva_imp_${r}` : null;
    case "exempt": return "p_iva_exento";
    case "not_subject": return "p_iva_nosujeto";
    case "retention": return [7, 15, 19].includes(b.rate) ? `p_ret_${r}` : null;
    default: return null; // re, igic, ipsi, foreign_vat
  }
}
export function isSelfAssessed(b: VatBand) { return SELF_ASSESSED.has(b.regime || "iva"); }

// ── lines ────────────────────────────────────────────────────────────────
export type Line = {
  line_number: number; product_code?: string | null; product_name?: string | null;
  quantity?: number | null; unit?: string | null; unit_price_eur?: number | null;
  discount_pct?: number | null; line_subtotal_eur?: number | null; vat_rate?: number | null;
  vat_amount_eur?: number | null; line_total_eur?: number | null; confidence?: number | null;
};

// Rows the OCR returns that are totals, not products
// ([[catalogue_totals_rows_stored_as_ingredients]]).
const TOTALS_ROW = /^\s*(total(es)?|sub\s*total|suma|base\s*imponible|b\.?\s*imp|i\.?v\.?a\.?|cuota|importe\s+total|total\s+factura|total\s+albar[aá]n|neto|recargo|re\s*\d)/i;
export function isTotalsRow(l: Line): boolean {
  return TOTALS_ROW.test(String(l.product_name || ""));
}

// qty × price × (1 − disc/100) == subtotal, ±2 cents
// ([[catalogue_ocr_needs_arithmetic_assert]], [[holded_purchase_line_value_needs_discount]]).
export function lineArithmeticOk(l: Line): boolean | null {
  const q = num(l.quantity), p = num(l.unit_price_eur), s = num(l.line_subtotal_eur);
  if (q === null || p === null || s === null) return null;
  const d = num(l.discount_pct) || 0;
  return Math.abs(r2(q * p * (1 - d / 100)) - s) <= 0.02;
}

export function checkLines(lines: Line[], base: number | null): { keep: Line[]; flags: string[]; bad: number[] } {
  const flags: string[] = [];
  const bad: number[] = [];
  const keep = lines.filter((l) => !isTotalsRow(l) && String(l.product_name || "").trim() !== "");
  for (const l of keep) if (lineArithmeticOk(l) === false) bad.push(l.line_number);
  if (bad.length) flags.push("line_arithmetic_mismatch");
  if (base !== null && keep.length) {
    const sum = r2(keep.reduce((a, l) => a + (num(l.line_subtotal_eur) || 0), 0));
    if (Math.abs(sum - base) > Math.max(0.05, keep.length * 0.01)) flags.push("lines_dont_reconcile_to_base");
  }
  return { keep, flags, bad };
}

// ── document type ────────────────────────────────────────────────────────
export type DocType = "invoice" | "albaran" | "ticket" | "quote" | "statement" | "eod" | "other";
// Decide on the printed word first; the model's own label is the fallback.
export function docTypeFromWord(word: string | null | undefined, modelType: string | null | undefined): DocType {
  const w = normName(word);
  if (/\bALBAR|NOTA DE ENTREGA|DELIVERY NOTE|REMITO|HOJA DE ENTREGA/.test(w)) return "albaran";
  if (/\bEXTRACTO|\bRELACION DE FACTURAS|\bCARTA DE COBRO|\bSTATEMENT|\bRESUMEN/.test(w)) return "statement";
  if (/\bFACTURA SIMPLIFICADA|\bTICKET|\bTIQUE/.test(w)) return "ticket";
  if (/\bRECTIFICATIVA|\bABONO|\bFACTURA|\bINVOICE/.test(w)) return "invoice";
  if (/\bPRESUPUESTO|\bPROFORMA|\bQUOTE|\bOFERTA/.test(w)) return "quote";
  if (/\bCIERRE|\bARQUEO|\bINFORME Z|\bZ REPORT/.test(w)) return "eod";
  const m = String(modelType || "").toLowerCase();
  return (["invoice", "albaran", "ticket", "quote", "statement", "eod"].includes(m) ? m : "other") as DocType;
}

// ── dedup ────────────────────────────────────────────────────────────────
export type PriorDoc = { id: string; supplier_cif: string | null; doc_no: string | null; total: number | null; alt_totals?: number[] };
export type DedupVerdict =
  | { kind: "new" }
  | { kind: "duplicate"; of: string }
  | { kind: "conflict"; of: string; prior_total: number | null };

export function dedup(cand: { supplier_cif: string | null; doc_no: string | null; total: number | null }, prior: PriorDoc[]): DedupVerdict {
  const cif = normTaxId(cand.supplier_cif), no = normDocNo(cand.doc_no);
  if (!cif || !no) return { kind: "new" };
  const same = prior.filter((p) => normTaxId(p.supplier_cif) === cif && normDocNo(p.doc_no) === no);
  if (!same.length) return { kind: "new" };
  const hit = (t: number | null) => t !== null && cand.total !== null && Math.abs(t - cand.total) <= 0.01;
  // A copy that matches the kept total OR a total already recorded as a
  // conflicting copy is a re-scan, not new information.
  const exact = same.find((p) => hit(p.total) || (p.alt_totals || []).some(hit));
  if (exact) return { kind: "duplicate", of: exact.id };
  return { kind: "conflict", of: same[0].id, prior_total: same[0].total };
}

// ── many albaranes → one invoice ─────────────────────────────────────────
export type AlbCand = { id: string; date: string; amount: number; doc_no: string | null };
export type MatchVerdict =
  | { kind: "matched"; ids: string[]; by: "referenced" | "subset" }
  | { kind: "ambiguous"; solutions: number }
  | { kind: "none" };

const dayNum = (iso: string) => Math.floor(Date.parse(iso + "T00:00:00Z") / 86400000);

// Candidates: same supplier + entity, unlinked, dated within `windowDays`
// BEFORE (or on) the invoice date. First try the albarán numbers the invoice
// prints (Meneghello/Juntos list them); then a unique subset-sum on cents.
export function matchAlbaranes(
  inv: { date: string; amount: number; text?: string | null },
  cands: AlbCand[],
  opts: { windowDays?: number; tolCents?: number; subsetTolCents?: number; maxCands?: number } = {},
): MatchVerdict {
  // Referenced albaranes (numbers printed on the invoice) may differ by VAT
  // rounding → 5 c. A blind subset-sum gets 1 c: at 5 c the real Juntos pile
  // produced a false 2-albarán "match" (126.09 + 71.83 = 197.92 vs 197.96).
  const windowDays = opts.windowDays ?? 45, refTol = opts.tolCents ?? 5, maxN = opts.maxCands ?? 60;
  const tol = opts.subsetTolCents ?? 1;
  const d0 = dayNum(inv.date);
  const pool = cands
    .filter((c) => c.amount > 0 && dayNum(c.date) <= d0 && d0 - dayNum(c.date) <= windowDays)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-maxN);
  const target = Math.round(inv.amount * 100);

  // 1) referenced on the invoice
  const text = normDocNo(inv.text || "") || "";
  if (text) {
    const refd = pool.filter((c) => {
      const n = normDocNo(c.doc_no);
      return !!n && n.length >= 4 && text.includes(n);
    });
    if (refd.length) {
      const sum = refd.reduce((a, c) => a + Math.round(c.amount * 100), 0);
      if (Math.abs(sum - target) <= refTol) return { kind: "matched", ids: refd.map((c) => c.id), by: "referenced" };
    }
  }

  // 2) unique subset-sum. counts[s] = number of subsets hitting s (capped at 2);
  //    choice[i][s] remembers whether item i was used, for reconstruction.
  const amts = pool.map((c) => Math.round(c.amount * 100));
  const cap = target + tol;
  if (cap <= 0 || cap > 5_000_000) return { kind: "none" };
  let counts = new Uint8Array(cap + 1);
  counts[0] = 1;
  const took: Uint8Array[] = [];
  for (let i = 0; i < amts.length; i++) {
    const a = amts[i];
    const next = counts.slice();
    const t = new Uint8Array(cap + 1);
    for (let s = cap; s >= a; s--) {
      if (counts[s - a]) {
        const v = next[s] + counts[s - a];
        next[s] = v > 2 ? 2 : v;
        if (!counts[s]) t[s] = 1;
      }
    }
    took.push(t);
    counts = next;
  }
  let solutions = 0, hitSum = -1;
  for (let s = Math.max(1, target - tol); s <= cap; s++) {
    if (counts[s]) { solutions += counts[s]; hitSum = s; }
  }
  if (solutions === 0) return { kind: "none" };
  if (solutions > 1) return { kind: "ambiguous", solutions };
  // reconstruct the single path
  const ids: string[] = [];
  let s = hitSum;
  for (let i = amts.length - 1; i >= 0 && s > 0; i--) {
    if (took[i][s]) { ids.push(pool[i].id); s -= amts[i]; }
  }
  if (s !== 0) return { kind: "ambiguous", solutions: 2 };
  return { kind: "matched", ids: ids.reverse(), by: "subset" };
}

// ── push gate ────────────────────────────────────────────────────────────
// Flags that block a Holded push outright. Everything else is shown as a
// warning next to the tick.
export const BLOCKING_FLAGS = [
  "entity_guessed", "third_party_addressee", "conflicting_copies", "duplicate",
  "totals_dont_reconcile", "no_supplier_cif", "no_doc_number", "vat_rate_category_mismatch",
  "tax_regime_needs_accountant", "no_customer_details",
] as const;
export function pushBlockers(row: { doc_type: string | null; flags: string[] | null; holded_doc_id: string | null; match_status: string | null; vat_bands: VatBand[] | null }): string[] {
  const out: string[] = [];
  if (row.holded_doc_id) out.push("already_in_holded");
  if (row.doc_type !== "invoice") out.push(`doc_type_${row.doc_type || "unknown"}`);
  if (!row.vat_bands || !row.vat_bands.length) out.push("no_vat_bands");
  if (row.match_status === "rejected" || row.match_status === "duplicate") out.push(`status_${row.match_status}`);
  for (const f of row.flags || []) if ((BLOCKING_FLAGS as readonly string[]).includes(f)) out.push(f);
  for (const b of row.vat_bands || []) if (b.base !== 0 && !holdedTaxKey(b)) out.push(`no_holded_tax_key_${b.regime || "iva"}_${b.rate}`);
  return Array.from(new Set(out));
}

// ── IVA rate vs what was bought ──────────────────────────────────────────
// The class-B and GGM findings were wrong rates booked as printed. These
// categories are 21 % in Spain; anything else on them is the supplier's
// error to fix, not ours to deduct. (Carburantes Baleares 102470 printed
// fuel at 10 %.) Food rates (4/10) are not policed here — too many edge cases.
const MUST_21: { cat: string; re: RegExp }[] = [
  { cat: "fuel", re: /\b(CARBURANTES?|GASOIL|GASOLEO|DIESEL|GASOLINAS?|GASOLINERA|ESTACION DE SERVICIO|SIN PLOMO|ADBLUE|COMBUSTIBLES?|SP ?95|SP ?98|REPSOL|CEPSA|GALP)\b/ },
  { cat: "energy", re: /\b(ELECTRICIDAD|ENERGIA ELECTRICA|TERMINO DE (ENERGIA|POTENCIA)|KWH|GAS NATURAL|BUTANO|PROPANO|ENDESA|IBERDROLA|NATURGY|RESPIRA ENERGIA|GESA)\b/ },
  { cat: "equipment_service", re: /\b(MAQUINARIA|REPARACION|MANTENIMIENTO|SERVICIO TECNICO|MANO DE OBRA|DESPLAZAMIENTO|ALQUILER|RENTING|LEASING|INSTALACION)\b/ },
  { cat: "alcohol", re: /\b(VINO|VINS?|CERVEZA|CAVA|CHAMPAGNE|GINEBRA|GIN|RON|WHISK(E)?Y|VODKA|LICOR|VERMUT|TEQUILA|MEZCAL|BRANDY|COGNAC|SIDRA)\b/ },
];
export type VatCategoryIssue = { where: string; cat: string; printed: number; expected: 21 };

export function vatCategoryCheck(doc: { supplier_name?: string | null; lines?: Line[]; bands?: VatBand[] }): VatCategoryIssue[] {
  const out: VatCategoryIssue[] = [];
  const sup = normName(doc.supplier_name);
  const supCat = MUST_21.find((c) => (c.cat === "fuel" || c.cat === "energy") && c.re.test(sup));
  if (supCat) {
    // A fuel/energy supplier: every band must be 21 %.
    for (const b of doc.bands || []) if ((b.regime || "iva") === "iva" && b.base !== 0 && b.rate !== 21) out.push({ where: `document band ${b.rate}%`, cat: supCat.cat, printed: b.rate, expected: 21 });
  }
  for (const l of doc.lines || []) {
    const rate = num(l.vat_rate);
    if (rate === null || rate === 21) continue;
    const name = normName(l.product_name);
    const hit = MUST_21.find((c) => c.re.test(name));
    if (hit) out.push({ where: `line ${l.line_number} "${String(l.product_name).slice(0, 40)}"`, cat: hit.cat, printed: rate, expected: 21 });
  }
  return out;
}

// ── Holded contact for this supplier ─────────────────────────────────────
// Holded carries the same supplier under several spellings, sometimes on the
// SAME CIF (MENEGHELLO FISH SL + MENEGHELLO FOOD SL both B16515413). Posting
// by contactCode alone lets Holded pick one — or invent a new contact. So the
// contact is resolved here and anything but a single CIF hit goes to a human.
export type HContact = { id: string; name: string | null; code?: string | null; vatnumber?: string | null; tradeName?: string | null; type?: string | null; email?: string | null };
export type ContactVerdict =
  | { kind: "cif"; id: string; name: string | null }
  | { kind: "choose"; reason: "same_cif_several_contacts" | "name_lookalikes"; candidates: HContact[] }
  | { kind: "new" };

const STOP = new Set(["SL", "SA", "SLU", "SOCIEDAD", "LIMITADA", "DE", "DEL", "LA", "EL", "LOS", "LAS", "Y", "HERMANOS", "IBIZA", "EIVISSA", "GRUPO", "FOOD", "FOODS", "COMERCIAL"]);
const tokens = (s: string | null | undefined) => normName(s).split(" ").filter((t) => t.length >= 4 && !STOP.has(t));

export function resolveHoldedContact(cifRaw: string | null | undefined, name: string | null | undefined, all: HContact[]): ContactVerdict {
  // Contacts already retired in Holded ("[DUPLICATE - do not use] VIAPA PLAGE SL …") never receive new documents.
  const contacts = all.filter((c) => !/^\s*\[?\s*DUPLICA/i.test(String(c.name || "")));
  const cif = normTaxId(cifRaw);
  if (cif) {
    const byCif = contacts.filter((c) => normTaxId(c.code) === cif || normTaxId(c.vatnumber) === cif);
    if (byCif.length === 1) return { kind: "cif", id: byCif[0].id, name: byCif[0].name };
    if (byCif.length > 1) return { kind: "choose", reason: "same_cif_several_contacts", candidates: byCif };
  }
  const mine = new Set(tokens(name));
  if (mine.size) {
    const look = contacts.filter((c) => [...tokens(c.name), ...tokens(c.tradeName)].some((t) => mine.has(t)));
    if (look.length) return { kind: "choose", reason: "name_lookalikes", candidates: look.slice(0, 8) };
  }
  return { kind: "new" };
}

// ── tickets ↔ facturas (BUILD_PROMPT §11–12) ─────────────────────────────
// A factura that replaces a ticket prints the ticket number on its face
// ("Factura Simplificada: 4253-025-934413"), so the join is deterministic.
// One-character differences are OUR misread (4251-… vs 4253-018-870315 on
// the real pile): accept them only when date and total agree too, and let the
// factura's value (printed digitally) win.
export function ticketMatch(ticketNo: string | null | undefined, facturaRef: string | null | undefined): "exact" | "one_off" | null {
  const a = normDocNo(ticketNo), b = normDocNo(facturaRef);
  if (!a || !b || a.length < 6) return null;
  if (a === b) return "exact";
  if (a.length !== b.length) return null;
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && ++d > 1) return null;
  return d === 1 ? "one_off" : null;
}

// Where a ticket stands. The three jobs the prompt insists stay distinct:
// resolved (factura found), obtainable (request it — client or new), impossible.
export type FacturaStatus = "unchecked" | "resolved" | "requestable_client" | "requestable_new" | "awaiting_factura" | "consolidated" | "not_obtainable";
export function ticketStatus(s: { hasFactura: boolean; consolidated: boolean; isClient: boolean; requested: boolean; impossible: boolean }): FacturaStatus {
  if (s.hasFactura) return "resolved";
  if (s.impossible) return "not_obtainable";
  if (s.consolidated) return "consolidated";
  if (s.requested) return "awaiting_factura";
  return s.isClient ? "requestable_client" : "requestable_new";
}

export type FiscalParty = { legal_name: string; tax_id: string; address?: string | null };
export function facturaRequestDraft(a: {
  template: "client" | "new"; supplier: string; ticket: string | null; date: string | null; amount: number | null; us: FiscalParty; signer?: string;
}) {
  const eurES = (n: number | null) => n == null ? "—" : n.toFixed(2).replace(".", ",") + " €";
  const d = a.date ? a.date.split("-").reverse().join("/") : "—";
  const fiscal = `${a.us.legal_name}\nNIF: ${a.us.tax_id}\n${a.us.address || "[domicilio fiscal]"}`;
  const sign = `${a.signer || "Boris Buono"}\n${a.us.legal_name}`;
  if (a.template === "client") {
    return {
      subject: `Solicitud de factura — ticket ${a.ticket || ""} del ${d} (${eurES(a.amount)})`.replace("  ", " "),
      body: `Buenos días,\n\nOs pedimos la factura completa correspondiente al ticket ${a.ticket || "adjunto"} del ${d}, por importe de ${eurES(a.amount)}, a nombre de:\n\n${fiscal}\n\nAdjuntamos copia del ticket.\n\nMuchas gracias,\n${sign}`,
    };
  }
  return {
    subject: `Alta como cliente y factura del ticket ${a.ticket || ""} del ${d}`.replace("  ", " "),
    body: `Buenos días,\n\nSomos ${a.us.legal_name}. Os escribimos para daros de alta nuestros datos fiscales, de forma que las próximas compras se facturen directamente a nuestro nombre:\n\n${fiscal}\n\nY os pedimos, por favor, la factura del ticket ${a.ticket || "adjunto"} del ${d}, por importe de ${eurES(a.amount)}. Adjuntamos copia del ticket.\n\nMuchas gracias,\n${sign}`,
  };
}
