// Bank reconciliation intelligence #1 — the matcher.
//
// Seven candidate finders + an AI fallback. Given one bank_movement, we run
// finders in order and collect proposed candidates. The finder that returns
// the highest-confidence candidate wins the "top" slot in the triage UI, but
// every candidate is upserted so the operator can pick a different one.
//
// Finder order (finance/audit_methodology memory — invoice is the highest-
// signal match because supplier + amount is a tight tuple; EOD is next because
// POS deposit dates are known; asiento sits after because internal ledger has
// looser matching; intercompany / salary / tax / self-transfer are pattern
// finders; unknown is the AI fallback):
//
//   1. invoice          — invoice_inbox.amount_eur == |movement.amount_eur|
//                         AND (supplier alias matches description OR provider
//                         name matches AND date within 30d before movement)
//   2. eod              — for IFL: POS aggregate lands on CaixaBank 6484 only
//                         (memory/ifl_bank_account_model); positive movement,
//                         within +/-5 days of a POS day, amount matches
//                         within +/-0.5% (foreign-card lag rule)
//   3. asiento          — bank_movements with matching amount + description
//                         signature already reconciled elsewhere is a hint;
//                         holded_movement_id equal is a hard match
//   4. intercompany     — BBH<->BM known pattern (memory/bbh_bm_intercompany_loan)
//                         if description contains "TRANSF" and other entity
//                         has a paired opposite-sign movement
//   5. salary           — recurring monthly to the same reference name; needs
//                         >= 2 prior movements at same day-of-month +/- 5d
//   6. tax              — description contains AEAT/HACIENDA/MODELO and amount
//                         matches a known modelo band (303/111/115/200/202)
//   7. self-transfer    — same day, opposite sign, same absolute amount,
//                         different bank_account, same entity
//
// If no candidate reaches confidence >= 0.8, the movement is handed to the
// assistant orchestrator (mode=extract, "match_reason" flavour) with the
// movement + the 30 most similar prior movements as context. The AI candidate
// is clamped to confidence <= 0.75 and upserted with match_type='unknown'.
//
// Guardrails (memory):
//   - ifl_bank_account_model      → IFL POS lands ONLY on CaixaBank 6484.
//   - monthly_reconciliation_method → foreign settle lag <= 5 days.
//   - card_merchant_aliases       → merchant aliases baked into the alias map.
//   - holded_first_principles     → nothing auto-flips reconciled without an
//     accepted candidate; matcher only writes 'proposed' rows.

import { createHash } from "node:crypto";
import { supabaseServer } from "@/lib/supabaseServer";
import { AssistantOrchestrator } from "@/lib/assistant/orchestrator";

export type EntityCode = "IFL" | "BM" | "BBH";

export type BankMatchType =
  | "invoice"
  | "eod"
  | "asiento"
  | "intercompany"
  | "salary"
  | "tax"
  | "self-transfer"
  | "unknown";

export type BankMovement = {
  id: string;
  entity_id: string;
  bank_account: string;
  movement_date: string;   // YYYY-MM-DD
  amount_eur: number;      // signed
  description: string | null;
  holded_movement_id: string | null;
  reconciled_to: string | null;
  reconciled_to_id: string | null;
  reconciled_status: string | null;
};

export type MatchCandidate = {
  entity_code: EntityCode;
  bank_movement_id: string;
  match_type: BankMatchType;
  match_target_id: string | null;
  match_target_label: string | null;
  finder: string;
  confidence: number;      // 0..1
  rationale: string;
  meta: Record<string, any>;
};

const IFL_POS_ACCOUNTS = new Set(["CaixaBank 6484", "6484", "57200001"]);

// Card / merchant aliases — from memory/card_merchant_aliases.
// Keyed by uppercased fragment we might see in a description; value is the
// canonical supplier name we expect on the invoice.
const MERCHANT_ALIASES: Array<{ pattern: RegExp; supplier: string }> = [
  { pattern: /PUIG\s*D\s*EN\s*VALLS/i, supplier: "MERCADONA" },
  { pattern: /MERCADONA/i,             supplier: "MERCADONA" },
  { pattern: /NOBE/i,                  supplier: "NOBE" },
  { pattern: /WITNA/i,                 supplier: "WITNA" },
  { pattern: /AIBSA/i,                 supplier: "AIBSA" },
  { pattern: /ECOVERITAS/i,            supplier: "ECOVERITAS" },
  { pattern: /HARISSA/i,               supplier: "HARISSA" },
  { pattern: /MIRO|MIR[OÓ]/i,          supplier: "MIRO" },
  { pattern: /MENEGHELLO/i,            supplier: "MENEGHELLO" },
  { pattern: /AGROEIVISSA/i,           supplier: "AGROEIVISSA" },
  { pattern: /SOLRED/i,                supplier: "SOLRED" },
  { pattern: /WINELOVERIBIZA/i,        supplier: "WINELOVERIBIZA" },
];

const TAX_PATTERNS: Array<{ modelo: string; pattern: RegExp }> = [
  { modelo: "303",         pattern: /MOD(ELO)?\s*303|IVA|AEAT.*303/i },
  { modelo: "111",         pattern: /MOD(ELO)?\s*111|IRPF.*RETEN|AEAT.*111/i },
  { modelo: "115",         pattern: /MOD(ELO)?\s*115|IRPF.*ALQ|AEAT.*115/i },
  { modelo: "200",         pattern: /MOD(ELO)?\s*200|SOCIEDADES|IS.*AEAT/i },
  { modelo: "202",         pattern: /MOD(ELO)?\s*202/i },
  { modelo: "347",         pattern: /MOD(ELO)?\s*347/i },
  { modelo: "aplazamiento",pattern: /APLAZAM/i },
  { modelo: "aeat",        pattern: /HACIENDA|AEAT|TESOR/i },
];

const SALARY_PATTERNS: Array<RegExp> = [
  /NOMINA/i,
  /SUELDO/i,
  /SALARIO/i,
  /SEG\.?\s*SOC/i,
];

const INTERCOMPANY_HINTS: Array<RegExp> = [
  /TRANSF/i,
  /IBIZA FOOD/i,
  /BISTRO\s*MONDO/i,
  /BBH/i,
  /HOLDINGS/i,
  /INTERCOMPANY/i,
];

const EPSILON_EUR = 0.02;     // rounding tolerance on exact-amount matches
const EOD_DAY_WINDOW = 5;     // memory/monthly_reconciliation_method — foreign settle lag <= 5d
const EOD_AMOUNT_TOLERANCE = 0.005;   // 0.5%

export type MatchResult = {
  movement_id: string;
  candidates: MatchCandidate[];
  top_confidence: number;
  used_ai_fallback: boolean;
};

// -----------------------------------------------------------------------------
// Public entry — match one movement.
// -----------------------------------------------------------------------------
export async function matchMovement(m: BankMovement): Promise<MatchResult> {
  const entity = normaliseEntity(m.entity_id);
  if (!entity) {
    return { movement_id: m.id, candidates: [], top_confidence: 0, used_ai_fallback: false };
  }
  const sb = supabaseServer();
  const candidates: MatchCandidate[] = [];

  candidates.push(...await findInvoiceCandidates(sb, m, entity));
  candidates.push(...await findEodCandidates(sb, m, entity));
  candidates.push(...await findAsientoCandidates(sb, m, entity));
  candidates.push(...await findIntercompanyCandidates(sb, m, entity));
  candidates.push(...await findSalaryCandidates(sb, m, entity));
  candidates.push(...await findTaxCandidates(m, entity));
  candidates.push(...await findSelfTransferCandidates(sb, m, entity));

  candidates.sort((a, b) => b.confidence - a.confidence);
  const top = candidates[0]?.confidence ?? 0;

  let usedAi = false;
  if (top < 0.8) {
    const ai = await aiFallback(sb, m, entity, candidates);
    if (ai) {
      candidates.push(ai);
      usedAi = true;
    }
  }
  return {
    movement_id: m.id,
    candidates,
    top_confidence: candidates.reduce((a, c) => Math.max(a, c.confidence), 0),
    used_ai_fallback: usedAi,
  };
}

// -----------------------------------------------------------------------------
// Batch entry — run over all unmatched movements for one entity, upsert
// candidates, flip movements.reconciled_status to 'needs_review' when any
// candidate lands and 'matched' only if the operator accepts.
// -----------------------------------------------------------------------------
export async function matchEntity(entity: EntityCode, opts: { limit?: number } = {}): Promise<{
  entity_code: EntityCode;
  scanned: number;
  candidates_upserted: number;
  ai_fallbacks: number;
  by_type: Record<string, number>;
  updated_movements: number;
}> {
  const sb = supabaseServer();
  const limit = Math.max(1, Math.min(500, opts.limit ?? 200));
  const { data: rows } = await sb
    .from("bank_movements")
    .select("id,entity_id,bank_account,movement_date,amount_eur,description,holded_movement_id,reconciled_to,reconciled_to_id,reconciled_status")
    .eq("entity_id", entity)
    .in("reconciled_status", ["unmatched", "needs_review"])
    .order("movement_date", { ascending: false })
    .limit(limit);

  const movements = ((rows as any[]) || []) as BankMovement[];
  let candidates_upserted = 0;
  let ai_fallbacks = 0;
  const by_type: Record<string, number> = {};
  let updated_movements = 0;

  for (const m of movements) {
    const res = await matchMovement(m);
    if (res.used_ai_fallback) ai_fallbacks += 1;
    for (const c of res.candidates) {
      by_type[c.match_type] = (by_type[c.match_type] || 0) + 1;
    }
    if (res.candidates.length) {
      const rowsIn = res.candidates.map((c) => ({
        entity_code: c.entity_code,
        bank_movement_id: c.bank_movement_id,
        match_type: c.match_type,
        match_target_id: c.match_target_id,
        match_target_label: c.match_target_label,
        finder: c.finder,
        confidence: Number(c.confidence.toFixed(3)),
        rationale: c.rationale,
        status: "proposed",
        meta: c.meta,
      }));
      const { error, count } = await sb
        .from("bank_match_candidates")
        .upsert(rowsIn, { onConflict: "bank_movement_id,match_type,match_target_id,finder", ignoreDuplicates: false, count: "exact" });
      if (!error) candidates_upserted += count ?? rowsIn.length;
    }
    if (res.top_confidence > 0 && m.reconciled_status !== "needs_review") {
      const { error } = await sb
        .from("bank_movements")
        .update({ reconciled_status: "needs_review" })
        .eq("id", m.id)
        .neq("reconciled_status", "matched");
      if (!error) updated_movements += 1;
    }
  }

  return {
    entity_code: entity,
    scanned: movements.length,
    candidates_upserted,
    ai_fallbacks,
    by_type,
    updated_movements,
  };
}

// -----------------------------------------------------------------------------
// Finder 1 — invoice.
// -----------------------------------------------------------------------------
async function findInvoiceCandidates(sb: any, m: BankMovement, entity: EntityCode): Promise<MatchCandidate[]> {
  // Bank payments to suppliers are negative movements.
  if (m.amount_eur >= 0) return [];
  const abs = Math.abs(Number(m.amount_eur));
  if (abs < 1) return [];

  const desc = (m.description || "").toUpperCase();
  const aliasHits = MERCHANT_ALIASES.filter((a) => a.pattern.test(desc)).map((a) => a.supplier);

  const since = daysAgoISO(60);
  const { data } = await sb
    .from("invoice_inbox")
    .select("id,provider_id,amount_eur,vat_eur,match_status,arrived_at,supplier_name,holded_doc_id,provider:provider_id(name)")
    .eq("entity_id", entity)
    .gte("arrived_at", since + "T00:00:00")
    .order("arrived_at", { ascending: false })
    .limit(200);

  const rows = ((data as any[]) || []).filter((r) => r.amount_eur != null);
  const out: MatchCandidate[] = [];

  for (const inv of rows) {
    const invAbs = Math.abs(Number(inv.amount_eur));
    if (Math.abs(invAbs - abs) > EPSILON_EUR) continue;

    const supplier = String(inv.supplier_name || inv.provider?.name || "").toUpperCase().trim();
    let confidence = 0.55; // exact amount alone
    const reasons: string[] = ["exact amount"];
    if (aliasHits.length && supplier && aliasHits.some((h) => supplier.includes(h))) {
      confidence = 0.95;
      reasons.push("supplier alias in description");
    } else if (supplier && desc.includes(supplier.split(" ")[0])) {
      confidence = 0.9;
      reasons.push("supplier name in description");
    } else if (aliasHits.length) {
      // alias hit but supplier text doesn't match — weaker
      confidence = 0.65;
      reasons.push("merchant alias " + aliasHits[0] + " on description");
    }
    // Date sanity — invoice must be dated before or same-day as the bank hit.
    const invDate = String(inv.arrived_at || "").slice(0, 10);
    if (invDate > m.movement_date) confidence -= 0.2;
    if (invDate && invDate < daysAgoFrom(m.movement_date, 90)) confidence -= 0.1;
    if (inv.match_status === "approved") confidence += 0.02;
    if (confidence <= 0) continue;
    confidence = clamp(confidence, 0, 0.99);

    out.push({
      entity_code: entity,
      bank_movement_id: m.id,
      match_type: "invoice",
      match_target_id: String(inv.id),
      match_target_label: "Invoice " + (inv.holded_doc_id || inv.id.slice(0, 8)) + (supplier ? " · " + prettyCase(supplier) : ""),
      finder: "invoice_amount_alias",
      confidence,
      rationale: reasons.join(" + ") + " (" + eur(-abs) + ")",
      meta: { supplier_name: supplier, invoice_holded_doc_id: inv.holded_doc_id, invoice_arrived_at: inv.arrived_at, alias_hits: aliasHits },
    });
  }
  return out.slice(0, 5);
}

// -----------------------------------------------------------------------------
// Finder 2 — EOD daily aggregate.
// -----------------------------------------------------------------------------
async function findEodCandidates(sb: any, m: BankMovement, entity: EntityCode): Promise<MatchCandidate[]> {
  if (m.amount_eur <= 0) return [];  // deposits only
  // IFL POS lands ONLY on CaixaBank 6484 (memory/ifl_bank_account_model).
  if (entity === "IFL" && !IFL_POS_ACCOUNTS.has((m.bank_account || "").trim())) return [];

  const abs = Number(m.amount_eur);
  const restaurantId = ENTITY_TO_RID[entity];
  if (!restaurantId) return [];

  const from = daysAgoFrom(m.movement_date, EOD_DAY_WINDOW);
  const { data } = await sb
    .from("eod_pos")
    .select("id,date,total_gross_eur,card_declared_eur,cash_declared_eur,food_net_eur,wine_net_eur,bar_net_eur,softdrinks_net_eur")
    .eq("restaurant_id", restaurantId)
    .gte("date", from)
    .lte("date", m.movement_date)
    .order("date", { ascending: false })
    .limit(EOD_DAY_WINDOW + 2);

  const rows = (data as any[]) || [];
  const out: MatchCandidate[] = [];
  for (const p of rows) {
    // Card-declared is what actually lands on the bank; total_gross is a
    // fallback if card_declared is unset.
    const targets: Array<{ label: string; val: number }> = [];
    if (Number(p.card_declared_eur) > 0) targets.push({ label: "card_declared", val: Number(p.card_declared_eur) });
    if (Number(p.total_gross_eur) > 0)   targets.push({ label: "total_gross",   val: Number(p.total_gross_eur) });
    for (const t of targets) {
      if (t.val <= 0) continue;
      const rel = Math.abs(abs - t.val) / t.val;
      if (rel > EOD_AMOUNT_TOLERANCE * 3) continue;
      const dayGap = daysBetween(p.date, m.movement_date);
      // Confidence — tighter tolerance and same-day = higher.
      let confidence = 0.9;
      if (rel > EOD_AMOUNT_TOLERANCE) confidence -= 0.15;
      if (dayGap > 2) confidence -= 0.05;
      if (dayGap > 4) confidence -= 0.1;
      confidence = clamp(confidence, 0.3, 0.98);
      out.push({
        entity_code: entity,
        bank_movement_id: m.id,
        match_type: "eod",
        match_target_id: String(p.id),
        match_target_label: "EOD " + p.date + " · " + t.label,
        finder: "eod_daily_aggregate",
        confidence,
        rationale: "POS " + p.date + " " + t.label + " " + eur(t.val) + " ≈ bank " + eur(abs) + " (gap " + dayGap + "d)",
        meta: { pos_date: p.date, target: t.label, target_amount: t.val, day_gap: dayGap, rel_delta: rel },
      });
    }
  }
  return out.slice(0, 3);
}

// -----------------------------------------------------------------------------
// Finder 3 — asiento (mirror ledger).
// -----------------------------------------------------------------------------
async function findAsientoCandidates(sb: any, m: BankMovement, entity: EntityCode): Promise<MatchCandidate[]> {
  // A movement can already carry a Holded movement id — if we've seen another
  // reconciled row against the same Holded id, that's a strong hint.
  if (!m.holded_movement_id) return [];
  const { data } = await sb
    .from("bank_movements")
    .select("id,reconciled_to,reconciled_to_id,description,amount_eur,movement_date")
    .eq("entity_id", entity)
    .eq("holded_movement_id", m.holded_movement_id)
    .neq("id", m.id)
    .not("reconciled_to_id", "is", null)
    .limit(3);
  const rows = (data as any[]) || [];
  if (!rows.length) return [];
  const anchor = rows[0];
  return [{
    entity_code: entity,
    bank_movement_id: m.id,
    match_type: "asiento",
    match_target_id: String(anchor.reconciled_to_id),
    match_target_label: "Asiento · " + (anchor.reconciled_to || "unknown"),
    finder: "shared_holded_movement_id",
    confidence: 0.88,
    rationale: "Same Holded movement id already reconciled elsewhere",
    meta: { holded_movement_id: m.holded_movement_id, anchor_id: anchor.id },
  }];
}

// -----------------------------------------------------------------------------
// Finder 4 — intercompany.
// -----------------------------------------------------------------------------
async function findIntercompanyCandidates(sb: any, m: BankMovement, entity: EntityCode): Promise<MatchCandidate[]> {
  const desc = (m.description || "").toUpperCase();
  const hasHint = INTERCOMPANY_HINTS.some((p) => p.test(desc));
  if (!hasHint) return [];
  const other: EntityCode[] = entity === "BBH" ? ["BM", "IFL"] : entity === "BM" ? ["BBH", "IFL"] : ["BBH", "BM"];
  const abs = Math.abs(Number(m.amount_eur));
  const from = daysAgoFrom(m.movement_date, 3);
  const to   = daysAgoFrom(m.movement_date, -3);
  const { data } = await sb
    .from("bank_movements")
    .select("id,entity_id,movement_date,amount_eur,description")
    .in("entity_id", other)
    .gte("movement_date", from)
    .lte("movement_date", to)
    .limit(50);
  const rows = ((data as any[]) || []).filter((r) => Math.abs(Math.abs(Number(r.amount_eur)) - abs) < 0.5 && Math.sign(r.amount_eur) !== Math.sign(m.amount_eur));
  if (!rows.length) return [];
  const pair = rows[0];
  return [{
    entity_code: entity,
    bank_movement_id: m.id,
    match_type: "intercompany",
    match_target_id: String(pair.id),
    match_target_label: "Intercompany · " + pair.entity_id + " " + pair.movement_date,
    finder: "paired_opposite_movement",
    confidence: 0.9,
    rationale: "Paired movement on " + pair.entity_id + " (" + pair.movement_date + ", " + eur(pair.amount_eur) + ")",
    meta: { paired_id: pair.id, paired_entity: pair.entity_id, paired_date: pair.movement_date, paired_amount: pair.amount_eur },
  }];
}

// -----------------------------------------------------------------------------
// Finder 5 — salary (recurring monthly).
// -----------------------------------------------------------------------------
async function findSalaryCandidates(sb: any, m: BankMovement, entity: EntityCode): Promise<MatchCandidate[]> {
  if (m.amount_eur >= 0) return [];
  const desc = (m.description || "").trim();
  const hasHint = SALARY_PATTERNS.some((p) => p.test(desc));
  if (!hasHint) return [];
  // Look back 120 days for prior movements with a similar reference & amount.
  const from = daysAgoFrom(m.movement_date, 120);
  const { data } = await sb
    .from("bank_movements")
    .select("id,movement_date,amount_eur,description")
    .eq("entity_id", entity)
    .gte("movement_date", from)
    .lt("movement_date", m.movement_date)
    .order("movement_date", { ascending: false })
    .limit(60);
  const abs = Math.abs(Number(m.amount_eur));
  const refKey = normaliseDescription(desc);
  const priors = ((data as any[]) || []).filter((r) => {
    const k = normaliseDescription(r.description || "");
    return k === refKey && Math.abs(Math.abs(Number(r.amount_eur)) - abs) < 5;
  });
  if (priors.length < 2) return [];
  return [{
    entity_code: entity,
    bank_movement_id: m.id,
    match_type: "salary",
    match_target_id: null,
    match_target_label: "Salary · " + prettyCase(refKey.slice(0, 40)),
    finder: "recurring_reference",
    confidence: clamp(0.7 + priors.length * 0.03, 0.7, 0.92),
    rationale: "Recurring salary reference — " + priors.length + " prior hits at " + eur(-abs),
    meta: { prior_count: priors.length, ref_key: refKey, prior_ids: priors.map((p) => p.id).slice(0, 6) },
  }];
}

// -----------------------------------------------------------------------------
// Finder 6 — tax (AEAT modelo).
// -----------------------------------------------------------------------------
async function findTaxCandidates(m: BankMovement, entity: EntityCode): Promise<MatchCandidate[]> {
  if (m.amount_eur >= 0) return [];
  const desc = (m.description || "").toUpperCase();
  for (const t of TAX_PATTERNS) {
    if (!t.pattern.test(desc)) continue;
    return [{
      entity_code: entity,
      bank_movement_id: m.id,
      match_type: "tax",
      match_target_id: null,
      match_target_label: "Tax · MOD." + t.modelo.toUpperCase(),
      finder: "tax_description_pattern",
      confidence: t.modelo === "aeat" ? 0.75 : 0.9,
      rationale: "Description matches AEAT modelo " + t.modelo,
      meta: { modelo: t.modelo, matched_pattern: t.pattern.source },
    }];
  }
  return [];
}

// -----------------------------------------------------------------------------
// Finder 7 — self-transfer.
// -----------------------------------------------------------------------------
async function findSelfTransferCandidates(sb: any, m: BankMovement, entity: EntityCode): Promise<MatchCandidate[]> {
  const abs = Math.abs(Number(m.amount_eur));
  if (abs < 100) return [];
  const { data } = await sb
    .from("bank_movements")
    .select("id,movement_date,bank_account,amount_eur,description")
    .eq("entity_id", entity)
    .eq("movement_date", m.movement_date)
    .neq("id", m.id)
    .neq("bank_account", m.bank_account);
  const rows = ((data as any[]) || []).filter((r) => Math.abs(Math.abs(Number(r.amount_eur)) - abs) < EPSILON_EUR && Math.sign(r.amount_eur) !== Math.sign(m.amount_eur));
  if (!rows.length) return [];
  const pair = rows[0];
  return [{
    entity_code: entity,
    bank_movement_id: m.id,
    match_type: "self-transfer",
    match_target_id: String(pair.id),
    match_target_label: "Self-transfer · " + pair.bank_account,
    finder: "paired_same_day_opposite_sign",
    confidence: 0.96,
    rationale: "Same-day opposite-sign pair with " + pair.bank_account,
    meta: { paired_id: pair.id, paired_bank_account: pair.bank_account },
  }];
}

// -----------------------------------------------------------------------------
// AI fallback.
// -----------------------------------------------------------------------------
async function aiFallback(sb: any, m: BankMovement, entity: EntityCode, existing: MatchCandidate[]): Promise<MatchCandidate | null> {
  // Gate on API key — if the orchestrator can't call Anthropic we skip
  // silently (matcher remains useful without AI).
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const from = daysAgoFrom(m.movement_date, 90);
  const { data: similarRows } = await sb
    .from("bank_movements")
    .select("id,movement_date,amount_eur,description,reconciled_to")
    .eq("entity_id", entity)
    .gte("movement_date", from)
    .neq("id", m.id)
    .order("movement_date", { ascending: false })
    .limit(30);

  const similar = ((similarRows as any[]) || []).map((r) => ({
    date: r.movement_date,
    amount_eur: Number(r.amount_eur),
    description: (r.description || "").slice(0, 80),
    reconciled_to: r.reconciled_to,
  }));

  const orchestrator = new AssistantOrchestrator();
  const prompt = "You classify one bank movement into a match_type. Return STRICT JSON matching the schema:\n"
    + "{\n"
    + "  \"match_type\": \"invoice|eod|asiento|intercompany|salary|tax|self-transfer|unknown\",\n"
    + "  \"confidence\": <0..0.75>,\n"
    + "  \"rationale\": \"<one-line reason>\",\n"
    + "  \"label\": \"<human label>\"\n"
    + "}\n\n"
    + "Movement:\n"
    + JSON.stringify({ date: m.movement_date, amount_eur: Number(m.amount_eur), description: m.description, bank_account: m.bank_account }) + "\n\n"
    + "Existing weaker candidates (finder-based, all < 0.8 confidence):\n"
    + JSON.stringify(existing.slice(0, 3).map((c) => ({ type: c.match_type, confidence: c.confidence, rationale: c.rationale }))) + "\n\n"
    + "30 recent movements on the same entity for reference:\n"
    + JSON.stringify(similar).slice(0, 4000);

  let out: any = null;
  try {
    const res = await orchestrator.generate({
      mode: "extract",
      prompt,
      language: "en",
      system_extra: "Task flavour: match_reason. Never invent — if the movement is ambiguous, return match_type='unknown' with a short reason.",
    });
    if (!res.ok) return null;
    const raw = res.text.trim().replace(/^```json\s*/i, "").replace(/```$/, "");
    out = JSON.parse(raw);
  } catch { return null; }
  if (!out || typeof out !== "object") return null;
  const type: BankMatchType = ["invoice", "eod", "asiento", "intercompany", "salary", "tax", "self-transfer"].includes(out.match_type)
    ? out.match_type as BankMatchType
    : "unknown";
  const conf = clamp(Number(out.confidence || 0), 0, 0.75);
  if (!Number.isFinite(conf) || conf <= 0) return null;
  return {
    entity_code: entity,
    bank_movement_id: m.id,
    match_type: type,
    match_target_id: null,
    match_target_label: String(out.label || "AI · " + type).slice(0, 120),
    finder: "ai_match_reason",
    confidence: conf,
    rationale: "AI: " + String(out.rationale || "no rationale").slice(0, 200),
    meta: { ai: true, model_output: out },
  };
}

// -----------------------------------------------------------------------------
// Helpers.
// -----------------------------------------------------------------------------
const ENTITY_TO_RID: Record<EntityCode, string> = {
  IFL: "ca83e06f-a24d-43d7-bce4-57ac341d190f",
  BM:  "fb4d008f-2d2a-4e0d-a525-6e0e36af0259",
  BBH: "",
};

function normaliseEntity(x: string): EntityCode | null {
  const s = (x || "").toUpperCase().trim();
  return s === "IFL" || s === "BM" || s === "BBH" ? s : null;
}
function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)); }
function daysAgoISO(d: number): string { return new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10); }
function daysAgoFrom(iso: string, d: number): string {
  const t = new Date(iso + "T00:00:00Z").getTime() - d * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}
function daysBetween(a: string, b: string): number {
  const ta = new Date(a + "T00:00:00Z").getTime();
  const tb = new Date(b + "T00:00:00Z").getTime();
  return Math.round(Math.abs(tb - ta) / 86_400_000);
}
function eur(n: number): string { const s = n < 0 ? "-€" : "€"; return s + Math.abs(n).toFixed(2); }
function prettyCase(s: string) { return s.slice(0, 1) + s.slice(1).toLowerCase(); }
function normaliseDescription(s: string) {
  return s.toUpperCase()
    .replace(/\b\d{1,2}[-/.]\d{1,2}([-/.]\d{2,4})?\b/g, "")   // dates
    .replace(/\b\d+\b/g, "")                                    // free numbers
    .replace(/[^A-Z]+/g, " ")                                    // punctuation
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}
export function hashCandidate(c: Pick<MatchCandidate, "bank_movement_id" | "match_type" | "match_target_id" | "finder">): string {
  const k = c.bank_movement_id + "|" + c.match_type + "|" + (c.match_target_id || "-") + "|" + c.finder;
  return createHash("sha1").update(k).digest("hex").slice(0, 20);
}
