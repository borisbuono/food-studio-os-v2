// Server-side glue for the hiring SOP: runs parse → score → question draft
// against one candidate row, using the caller's auth-bound client (RLS holds).
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildQuestionSet,
  firstName,
  parseCv,
  personalIntro,
  reviewFlags,
  scoreCandidate,
  type CvProfile,
} from "@/lib/hiring-sop";

export async function entityName(sb: SupabaseClient, entity_id: string): Promise<string> {
  const { data } = await sb.from("entities").select("name").eq("id", entity_id).maybeSingle();
  return (data?.name as string) || "our kitchen";
}

export async function openingFor(sb: SupabaseClient, id: string | null) {
  if (!id) return null;
  const { data } = await sb
    .from("job_openings")
    .select("id, title, role, station, languages_required")
    .eq("id", id)
    .maybeSingle();
  return data;
}

// Columns we mirror from the profile onto the candidate row so the kanban
// filters keep working.
export function mirrorColumns(p: Partial<CvProfile>) {
  const out: Record<string, unknown> = {};
  if (p.phone?.value) out.phone = String(p.phone.value).slice(0, 50);
  if (p.email?.value) out.email = String(p.email.value).slice(0, 200);
  if (p.languages?.value?.length) out.languages = p.languages.value.map((l) => String(l).slice(0, 12));
  if (p.kitchen_years?.value != null) out.years_experience = Number(p.kitchen_years.value);
  if (p.right_to_work?.value) out.right_to_work = String(p.right_to_work.value).slice(0, 40);
  if (p.location?.value) out.location = String(p.location.value).slice(0, 200);
  if (p.availability?.value) out.availability = String(p.availability.value).slice(0, 300);
  return out;
}

export async function rescore(sb: SupabaseClient, candidate_id: string) {
  const { data: c } = await sb
    .from("candidates")
    .select("id, profile, job_opening_id")
    .eq("id", candidate_id)
    .maybeSingle();
  if (!c) return null;
  const opening = await openingFor(sb, c.job_opening_id as string | null);
  const p = (c.profile || {}) as Partial<CvProfile>;
  const { score, reasons } = scoreCandidate(p, opening);
  await sb
    .from("candidates")
    .update({ score, score_reasons: reasons, review_flags: reviewFlags(p) })
    .eq("id", candidate_id);
  return { score, reasons };
}

// Replace any unsent question-set draft with a fresh one.
export async function draftQuestions(sb: SupabaseClient, candidate_id: string, uid: string, summary?: string | null) {
  const { data: c } = await sb
    .from("candidates")
    .select("id, name, entity_id, profile, summary, job_opening_id")
    .eq("id", candidate_id)
    .maybeSingle();
  if (!c) return null;
  const house = await entityName(sb, c.entity_id as string);
  const opening = await openingFor(sb, c.job_opening_id as string | null);
  const p = (c.profile || {}) as Partial<CvProfile>;
  const roleLabel = opening?.title ? String(opening.title) : "la cocina";
  const intro = await personalIntro(summary ?? (c.summary as string | null), p, house);
  const set = buildQuestionSet(firstName(String(c.name)), p, house, roleLabel, intro);

  const row = {
    candidate_id,
    channel: "email",
    direction: "outbound",
    kind: "question_set",
    status: "drafted",
    subject: set.subject,
    body: set.es,
    body_alt: set.en,
    language: "es",
    notes: "screening questions drafted — edit, send by hand, then Mark sent",
    by_user: uid,
  };
  // Update an unsent draft in place (touch deletes are manager-only under RLS).
  const { data: existing } = await sb
    .from("candidate_touches")
    .select("id")
    .eq("candidate_id", candidate_id)
    .eq("kind", "question_set")
    .eq("status", "drafted")
    .limit(1)
    .maybeSingle();
  const { data } = existing
    ? await sb.from("candidate_touches").update({ ...row, touched_at: new Date().toISOString() }).eq("id", existing.id).select("*").single()
    : await sb.from("candidate_touches").insert(row).select("*").single();
  return data;
}

export async function runCvPipeline(
  sb: SupabaseClient,
  candidate_id: string,
  uid: string,
  file: { base64: string; mediaType: string } | null,
  coverNote: string
) {
  const { profile, summary } = await parseCv(file, coverNote);
  const patch: Record<string, unknown> = {
    profile,
    summary,
    parsed_at: new Date().toISOString(),
    ...mirrorColumns(profile),
  };
  await sb.from("candidates").update(patch).eq("id", candidate_id);
  const scored = await rescore(sb, candidate_id);
  const draft = await draftQuestions(sb, candidate_id, uid, summary);
  return { profile, summary, scored, draft };
}

export async function moveStatus(
  sb: SupabaseClient,
  candidate_id: string,
  uid: string,
  to: string,
  reason: string,
  onlyFrom?: string[]
) {
  const { data: cur } = await sb
    .from("candidates")
    .select("status, status_history")
    .eq("id", candidate_id)
    .maybeSingle();
  if (!cur || cur.status === to) return false;
  if (onlyFrom && !onlyFrom.includes(cur.status as string)) return false;
  const hist = Array.isArray(cur.status_history) ? [...(cur.status_history as any[])] : [];
  hist.push({ at: new Date().toISOString(), from: cur.status, to, by: uid, reason });
  await sb.from("candidates").update({ status: to, status_history: hist }).eq("id", candidate_id);
  await sb.from("candidate_touches").insert({
    candidate_id,
    channel: "system",
    direction: "outbound",
    notes: `status: ${cur.status} → ${to} (${reason})`,
    by_user: uid,
  });
  return true;
}
