/**
 * Capture funnel (2026-09-26) — pure-logic checks against the real scan fixtures.
 * Run:
 *   node_modules/.bin/tsc tests/capture-funnel.test.ts --outDir /tmp/cf --module commonjs --target es2020 --skipLibCheck --types node \
 *     && node /tmp/cf/tests/capture-funnel.test.js "<path to 06_PA/Scanning>"
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  normTaxId, normDocNo, resolveEntityFromDoc, normaliseBands, bandTotals, checkLines,
  lineArithmeticOk, docTypeFromWord, dedup, matchAlbaranes, pushBlockers, num, type OwnEntity,
} from "../lib/capture/pure";

let fails = 0;
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
}

const OWN: OwnEntity[] = [
  { code: "BM", tax_id: "B13659594", legal_name: "Bistro Mondo Ibiza SL" },
  { code: "IFL", tax_id: "B57984593", legal_name: "Ibiza Food Lab SL" },
  { code: "BBH", tax_id: "B13655717", legal_name: "Boris Buono Holding SL" },
];

// identifiers
eq("taxid ES prefix", normTaxId("ES B-13.659.594"), "B13659594");
eq("docno whitespace", normDocNo("CF1F 27082") === normDocNo("CF1F27082"), true);
eq("docno slash", normDocNo("FVA/7734"), "FVA7734");

// entity from paper
eq("BM by CIF", resolveEntityFromDoc({ vat_id: "B13659594", name: "Bistro Mondo" }, OWN), { kind: "document", code: "BM", by: "cif" });
eq("IFL by CIF, dept line ignored", resolveEntityFromDoc({ vat_id: "B-57984593", name: "Ibiza Food Lab SL - Dept Bistro Mondo" }, OWN), { kind: "document", code: "IFL", by: "cif" });
eq("BBH by CIF", resolveEntityFromDoc({ vat_id: "B13655717", name: null }, OWN).kind === "document", true);
eq("BM by name only", resolveEntityFromDoc({ vat_id: null, name: "BISTRO MONDO IBIZA, S.L." }, OWN), { kind: "document", code: "BM", by: "name" });
eq("old BM CIF B57481517 → triage", resolveEntityFromDoc({ vat_id: "B57481517", name: "Bistro Mondo Ibiza SL" }, OWN).kind, "unknown");
eq("third party rejected", resolveEntityFromDoc({ vat_id: "B12345674", name: "PES MATT IBIZA SL" }, OWN).kind, "third_party");
eq("nothing readable → triage", resolveEntityFromDoc({ vat_id: null, name: null }, OWN).kind, "unknown");

// VAT bands
const nb = normaliseBands([{ rate: 10, base: 61.75, cuota: 6.17 }, { rate: 21, base: "12,00", cuota: "2,52" }, { rate: 10, base: 10, cuota: 1 }]);
eq("bands merged per rate", nb.bands, [{ rate: 10, base: 71.75, cuota: 7.17 }, { rate: 21, base: 12, cuota: 2.52 }]);
eq("band totals", bandTotals(nb.bands), { base: 83.75, vat: 9.69, total: 93.44 });
eq("cuota mismatch flagged", normaliseBands([{ rate: 21, base: 100, cuota: 10 }]).flags, ["vat_cuota_mismatch_21"]);
eq("spanish number", num("1.234,56"), 1234.56);

// lines
eq("line arith ok w/ discount", lineArithmeticOk({ line_number: 1, quantity: 3, unit_price_eur: 10, discount_pct: 10, line_subtotal_eur: 27 }), true);
eq("line arith bad", lineArithmeticOk({ line_number: 1, quantity: 3, unit_price_eur: 10, line_subtotal_eur: 33 }), false);
const cl = checkLines([
  { line_number: 1, product_name: "Tomate pera", quantity: 2, unit_price_eur: 1.5, line_subtotal_eur: 3 },
  { line_number: 2, product_name: "Base imponible", line_subtotal_eur: 3 },
  { line_number: 3, product_name: "TOTAL", line_subtotal_eur: 3.3 },
], 3);
eq("totals rows dropped", cl.keep.length, 1);
eq("lines reconcile", cl.flags, []);

// doc type from printed word — never from "has prices"
eq("albaran with prices", docTypeFromWord("ALBARÁN Nº", "invoice"), "albaran");
eq("factura", docTypeFromWord("Factura", "albaran"), "invoice");
eq("simplificada", docTypeFromWord("Factura simplificada", null), "ticket");
eq("carta de cobro", docTypeFromWord("Relación de facturas pendientes", "invoice"), "statement");

// dedup
const prior = [{ id: "a", supplier_cif: "B16607780", doc_no: "FVA/7734", total: 120 }];
eq("exact dup", dedup({ supplier_cif: "B16607780", doc_no: "FVA 7734", total: 120 }, prior), { kind: "duplicate", of: "a" });
eq("same no, other total → conflict", dedup({ supplier_cif: "B16607780", doc_no: "FVA7734", total: 197.96 }, prior), { kind: "conflict", of: "a", prior_total: 120 });
eq("other supplier → new", dedup({ supplier_cif: "B16515413", doc_no: "FVA7734", total: 120 }, prior).kind, "new");

// matcher
const al = [
  { id: "1", date: "2026-06-02", amount: 40.10, doc_no: "A-101" },
  { id: "2", date: "2026-06-09", amount: 55.25, doc_no: "A-102" },
  { id: "3", date: "2026-06-16", amount: 12.00, doc_no: "A-103" },
  { id: "4", date: "2026-04-01", amount: 95.35, doc_no: "A-090" }, // outside 45 d
];
eq("unique subset", matchAlbaranes({ date: "2026-06-30", amount: 95.35 }, al), { kind: "matched", ids: ["1", "2"], by: "subset" });
eq("referenced on invoice", matchAlbaranes({ date: "2026-06-30", amount: 107.35, text: "Albaranes: A-101, A-102, A-103" }, al), { kind: "matched", ids: ["1", "2", "3"], by: "referenced" });
eq("ambiguous left alone", matchAlbaranes({ date: "2026-06-30", amount: 10 }, [
  { id: "x", date: "2026-06-01", amount: 5, doc_no: null }, { id: "y", date: "2026-06-02", amount: 5, doc_no: null },
  { id: "z", date: "2026-06-03", amount: 10, doc_no: null }]).kind, "ambiguous");
eq("none", matchAlbaranes({ date: "2026-06-30", amount: 1.11 }, al).kind, "none");

eq("Juntos 197.96 is NOT 126.09+71.83 (4 c off)", matchAlbaranes({ date: "2026-07-10", amount: 197.96 }, [
  { id: "a", date: "2026-06-10", amount: 126.09, doc_no: null }, { id: "b", date: "2026-06-15", amount: 71.83, doc_no: null }]).kind, "none");

// push gate
eq("push blocked on guessed entity", pushBlockers({ doc_type: "invoice", flags: ["entity_guessed"], holded_doc_id: null, match_status: "unmatched", vat_bands: [{ rate: 10, base: 1, cuota: 0.1 }] }), ["entity_guessed"]);
eq("albaran never pushable", pushBlockers({ doc_type: "albaran", flags: [], holded_doc_id: null, match_status: "unmatched", vat_bands: [{ rate: 10, base: 1, cuota: 0.1 }] }), ["doc_type_albaran"]);

// ── fixtures ──
const dir = process.argv[2];
if (dir) {
  const csv = (f: string) => {
    const lines = readFileSync(join(dir, f), "utf8").trim().split(/\r?\n/);
    const split = (l: string) => { const out: string[] = []; let cur = "", q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === "," && !q) { out.push(cur); cur = ""; } else cur += ch; } out.push(cur); return out; };
    const h = split(lines[0]);
    return lines.slice(1).map((l) => Object.fromEntries(split(l).map((v, i) => [h[i], v])) as Record<string, string>);
  };
  const ex = csv("EXTRACTION_raw_batch_2026-09-26.csv");
  eq("fixture: 73 docs", ex.length, 73);
  const sum = ex.reduce((a, r) => a + (Number(r.total_eur) || 0), 0);
  eq("fixture: totals 11,324.96", Math.round(sum * 100) / 100, 11324.96);
  // Dedup run over the fixture in scan order
  const seen: { id: string; supplier_cif: string | null; doc_no: string | null; total: number | null; alt_totals?: number[] }[] = [];
  const verdicts: Record<string, number> = {};
  const conflicts: string[] = [];
  for (const r of ex) {
    const v = dedup({ supplier_cif: r.cif, doc_no: r.doc_number, total: Number(r.total_eur) }, seen);
    verdicts[v.kind] = (verdicts[v.kind] || 0) + 1;
    if (v.kind === "conflict") { conflicts.push(`${r.supplier_token} ${r.doc_number} ${r.total_eur}`); (seen.find((x) => x.id === v.of) as any).alt_totals = [Number(r.total_eur)]; }
    if (v.kind === "new") seen.push({ id: r.source_file, supplier_cif: r.cif, doc_no: r.doc_number, total: Number(r.total_eur) });
  }
  console.log("      fixture dedup:", JSON.stringify(verdicts), "conflicts:", conflicts.join(" | "));
  eq("fixture: Juntos FVA/7734 → exactly one conflict, third copy is a re-scan", conflicts.length === 1 && conflicts[0].includes("7734"), true);

  // Pairing test set: group candidates by invoice, unique albaranes per supplier
  const pc = csv("PAIRING_candidates_albaran_to_invoice.csv");
  const byInv = new Map<string, { inv: { date: string; amount: number }; cands: Map<string, any> }>();
  for (const r of pc) {
    const k = r.invoice;
    if (!byInv.has(k)) byInv.set(k, { inv: { date: r.inv_date, amount: Number(r.inv_amount) }, cands: new Map() });
    byInv.get(k)!.cands.set(r.albaran, { id: r.albaran, date: r.alb_date, amount: Number(r.alb_amount), doc_no: null });
  }
  const tally: Record<string, number> = {};
  const hits: string[] = [];
  for (const [k, g] of byInv) {
    const v = matchAlbaranes(g.inv, Array.from(g.cands.values()));
    tally[v.kind] = (tally[v.kind] || 0) + 1;
    if (v.kind === "matched") hits.push(`${k} ← ${v.ids.length} alb`);
  }
  console.log(`      pairing: ${byInv.size} invoices →`, JSON.stringify(tally));
  for (const h of hits) console.log("        " + h);
}

console.log(fails ? `\n${fails} FAIL` : "\nall pass");
process.exit(fails ? 1 : 0);
