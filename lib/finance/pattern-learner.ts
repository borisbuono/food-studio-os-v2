// Bank reconciliation intelligence #3 — pattern learner.
//
// After the operator accepts recurring matches on the same entity + type +
// normalised description, we promote them into recurring_bank_patterns so
// the matcher can auto-propose future occurrences with high confidence.
//
// learnFromAccepted(entity) is called after every accept batch (see the
// decide route's accept path — invoked lazily to keep decisions fast).
//
// A pattern is promoted when we've seen >= LEARN_THRESHOLD accepted
// candidates matching the same (match_type, normalised description) tuple
// in the last LEARN_WINDOW_DAYS. Amount range comes from the min/max seen;
// frequency is inferred from the median gap between hits.

import { supabaseServer } from "@/lib/supabaseServer";
import type { EntityCode, BankMatchType, MatchCandidate } from "./bank-matcher";

const LEARN_THRESHOLD = 3;
const LEARN_WINDOW_DAYS = 180;

const TYPE_TO_PATTERN_TYPE: Record<BankMatchType, string> = {
  invoice: "utility",
  eod: "utility",
  asiento: "utility",
  intercompany: "intercompany",
  salary: "salary",
  tax: "tax",
  "self-transfer": "utility",
  unknown: "utility",
};

export async function learnFromAccepted(entity: EntityCode): Promise<{ learned: number }> {
  const sb = supabaseServer();
  const since = new Date(Date.now() - LEARN_WINDOW_DAYS * 86_400_000).toISOString();
  const { data } = await sb
    .from("bank_match_candidates")
    .select("id,match_type,rationale,bank_movement_id,decided_at,bank_movements:bank_movement_id(entity_id,description,amount_eur,movement_date,bank_account)")
    .eq("entity_code", entity)
    .eq("status", "accepted")
    .gte("decided_at", since)
    .not("bank_movement_id", "is", null)
    .limit(500);
  const rows: any[] = (data as any[]) || [];
  if (!rows.length) return { learned: 0 };

  // Bucket by (match_type, normalised description).
  type Bucket = { count: number; amounts: number[]; dates: string[]; bank_accounts: Set<string>; ref: string; type: BankMatchType };
  const buckets = new Map<string, Bucket>();
  for (const r of rows) {
    const mv = Array.isArray(r.bank_movements) ? r.bank_movements[0] : r.bank_movements;
    if (!mv) continue;
    const ref = normalise(mv.description || "");
    if (!ref || ref.length < 5) continue;
    const key = r.match_type + "|" + ref;
    const b: Bucket = buckets.get(key) || { count: 0, amounts: [] as number[], dates: [] as string[], bank_accounts: new Set<string>(), ref, type: r.match_type };
    b.count += 1;
    b.amounts.push(Number(mv.amount_eur || 0));
    b.dates.push(String(mv.movement_date || "").slice(0, 10));
    if (mv.bank_account) b.bank_accounts.add(String(mv.bank_account));
    buckets.set(key, b);
  }

  let learned = 0;
  for (const [key, b] of buckets) {
    if (b.count < LEARN_THRESHOLD) continue;
    const [matchType] = key.split("|");
    const patternType = (TYPE_TO_PATTERN_TYPE as any)[matchType] || "utility";
    const min = Math.min(...b.amounts);
    const max = Math.max(...b.amounts);
    const sign = min < 0 && max < 0 ? "-" : min > 0 && max > 0 ? "+" : "mixed";
    const freq = inferFrequency(b.dates);
    const regex = referenceToRegex(b.ref);
    const label = prettyLabel(patternType, b.ref);
    const { error } = await sb
      .from("recurring_bank_patterns")
      .upsert({
        entity_code: entity,
        pattern_type: patternType,
        reference_regex: regex,
        expected_amount_range: { min, max, sign },
        expected_frequency: freq,
        match_type: matchType,
        label,
        learn_confidence: 0.9,
        first_seen: b.dates.sort()[0],
        last_seen: b.dates.sort().slice(-1)[0],
        times_matched: b.count,
        bank_account: b.bank_accounts.size === 1 ? [...b.bank_accounts][0] : null,
      }, { onConflict: "entity_code,pattern_type,reference_regex", ignoreDuplicates: false });
    if (!error) learned += 1;
  }
  return { learned };
}

// Called from bank-matcher.ts inline — takes the movement, checks active
// patterns first, and returns a candidate if any pattern matches.
export async function matchAgainstPatterns(entity: EntityCode, movement: { id: string; description: string | null; amount_eur: number; bank_account: string }): Promise<MatchCandidate | null> {
  const sb = supabaseServer();
  const { data } = await sb
    .from("recurring_bank_patterns")
    .select("id,pattern_type,reference_regex,expected_amount_range,expected_frequency,match_type,label,learn_confidence,bank_account,times_matched")
    .eq("entity_code", entity)
    .is("disabled_at", null)
    .limit(100);
  const patterns = (data as any[]) || [];
  const desc = movement.description || "";
  const abs = Math.abs(Number(movement.amount_eur));
  for (const p of patterns) {
    let re: RegExp;
    try { re = new RegExp(p.reference_regex, "i"); } catch { continue; }
    if (!re.test(desc)) continue;
    if (p.bank_account && p.bank_account !== movement.bank_account) continue;
    const range = p.expected_amount_range || {};
    const minAbs = range.min != null ? Math.abs(Number(range.min)) : null;
    const maxAbs = range.max != null ? Math.abs(Number(range.max)) : null;
    if (minAbs != null && abs < minAbs * 0.7) continue;
    if (maxAbs != null && abs > maxAbs * 1.3) continue;
    const rationale = "Recurring pattern · " + p.label + " (seen " + p.times_matched + "×, " + p.expected_frequency + ")";
    return {
      entity_code: entity,
      bank_movement_id: movement.id,
      match_type: p.match_type as BankMatchType,
      match_target_id: null,
      match_target_label: p.label,
      finder: "pattern_" + p.pattern_type,
      confidence: Number(p.learn_confidence || 0.9),
      rationale,
      meta: { pattern_id: p.id, pattern_type: p.pattern_type, times_matched: p.times_matched },
    };
  }
  return null;
}

// Bump times_matched + last_seen when the operator accepts a pattern-matched candidate.
export async function markPatternHit(patternId: string, movementDate: string): Promise<void> {
  const sb = supabaseServer();
  const { data: p } = await sb.from("recurring_bank_patterns").select("times_matched,first_seen").eq("id", patternId).maybeSingle();
  const times = Number(p?.times_matched || 0) + 1;
  const first = (p as any)?.first_seen || movementDate;
  await sb.from("recurring_bank_patterns").update({
    times_matched: times,
    last_seen: movementDate,
    first_seen: first,
    updated_at: new Date().toISOString(),
  }).eq("id", patternId);
}

function normalise(s: string): string {
  return s.toUpperCase()
    .replace(/\b\d{1,2}[-/.]\d{1,2}([-/.]\d{2,4})?\b/g, "")
    .replace(/\b\d+\b/g, "")
    .replace(/[^A-Z]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

function referenceToRegex(ref: string): string {
  // Split into tokens >=3 chars, escape, join with .*. Bounded by \b for
  // whole-word semantics.
  const tokens = ref.split(" ").filter((t) => t.length >= 3).slice(0, 6);
  if (!tokens.length) return "^$";
  return tokens.map((t) => "\\b" + t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b").join(".*");
}

function inferFrequency(datesRaw: string[]): "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly" | "irregular" {
  const dates = datesRaw.slice().sort();
  if (dates.length < 2) return "irregular";
  const gaps: number[] = [];
  for (let i = 1; i < dates.length; i++) {
    const t0 = new Date(dates[i - 1] + "T00:00:00Z").getTime();
    const t1 = new Date(dates[i] + "T00:00:00Z").getTime();
    gaps.push(Math.round((t1 - t0) / 86_400_000));
  }
  gaps.sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  if (median <= 9) return "weekly";
  if (median <= 17) return "biweekly";
  if (median <= 40) return "monthly";
  if (median <= 100) return "quarterly";
  if (median <= 400) return "yearly";
  return "irregular";
}

function prettyLabel(patternType: string, ref: string): string {
  const words = ref.split(" ").slice(0, 4).map((w) => w.slice(0, 1) + w.slice(1).toLowerCase()).join(" ");
  const pt = patternType.slice(0, 1).toUpperCase() + patternType.slice(1);
  return pt + " · " + (words || "unnamed");
}
