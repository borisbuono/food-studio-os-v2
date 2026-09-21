// lib/hiring-sop.ts — the SOP layer on top of the HR funnel.
//
//   CV in → parseCv (Claude reads the PDF) → scoreCandidate (plain rules,
//   every point explained) → buildQuestionSet (fixed SOP questions, ES + EN,
//   skipping what the CV already answers) → Boris edits, sends by hand,
//   taps "Mark sent" → reply pasted back → parseReply → re-score.
//
// Nothing here sends anything. Drafts only.

export const HIRING_MODEL = process.env.HIRING_MODEL || "claude-haiku-4-5-20251001";

export type Field<T = string> = { value: T | null; confidence: number };

export type CvProfile = {
  name: Field;
  phone: Field;
  email: Field;
  location: Field;
  lives_on_island_year_round: Field<boolean>;
  languages: Field<string[]>;           // ISO-ish: es, en, fr, it, de, ca, ar…
  kitchen_years: Field<number>;         // hospitality kitchen experience only
  total_years: Field<number>;
  current_role: Field;
  roles_held: Field<string[]>;          // "Jefa de partida cuarto frío — Can Mimosa (2026–)"
  stations: Field<string[]>;            // cuarto frío, pastelería, caliente, parrilla…
  seniority: Field;                     // commis | cocinero | jefe_partida | sous | chef
  training: Field<string[]>;
  right_to_work: Field;                 // yes | no | unknown
  availability: Field;                  // free text: "from Oct 2026, wants winter work"
  wants_year_round: Field<boolean>;
  // filled from the reply, not the CV
  notice_period?: Field;
  salary_expectation?: Field;
  weekends?: Field<boolean>;
  transport?: Field;
  references?: Field;
  station_preference?: Field;
  allergen_training?: Field;
};

export const LOW_CONFIDENCE = 0.6;

const CV_SYSTEM = `You read CVs for a restaurant kitchen in Ibiza (Bistro Mondo, Sant Joan de Labritja, rural north; and Taller Sa Penya, Ibiza town).
Return ONLY one JSON object, no prose, no code fences. Every field is {"value": ..., "confidence": 0..1}. Use null when the CV does not say — never guess to fill a gap; confidence reflects how explicitly the CV states it.
Keys:
name, phone, email, location (town/island as written),
lives_on_island_year_round (boolean — true only if the CV or cover note says so),
languages (array of 2-letter codes, include "es" if the CV is written in fluent Spanish),
kitchen_years (number — sum of professional kitchen jobs only, count internships; exclude non-hospitality jobs),
total_years (number, all work),
current_role (string), roles_held (array of "Role — Place (start–end)" newest first, kitchen and non-kitchen),
stations (array, Spanish kitchen terms as written: cuarto frío, pastelería, caliente, parrilla, etc.),
seniority (one of commis|ayudante|cocinero|jefe_partida|sous_chef|chef),
training (array of qualifications, short),
right_to_work ("yes" if EU/Spanish national or permit stated, "unknown" otherwise — do NOT infer from name or nationality guesses),
availability (short string), wants_year_round (boolean).
Also add "summary": {"value": "two plain sentences in English on who this cook is, no praise words", "confidence": 1}.`;

function stripJson(txt: string): any | null {
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

async function callClaude(content: any[], system: string, max_tokens = 1500): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY not set");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: HIRING_MODEL, max_tokens, system, messages: [{ role: "user", content }] }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || `anthropic ${r.status}`);
  return data?.content?.[0]?.text || "";
}

export async function parseCv(
  file: { base64: string; mediaType: string } | null,
  coverNote: string
): Promise<{ profile: CvProfile; summary: string | null }> {
  const content: any[] = [];
  if (file) {
    if (file.mediaType === "application/pdf") {
      content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: file.base64 } });
    } else if (file.mediaType.startsWith("image/")) {
      content.push({ type: "image", source: { type: "base64", media_type: file.mediaType, data: file.base64 } });
    }
  }
  content.push({ type: "text", text: `Cover note / email body (may be empty):\n${coverNote || "(none)"}\n\nReturn the JSON.` });
  const txt = await callClaude(content, CV_SYSTEM, 2000);
  const j = stripJson(txt);
  if (!j) throw new Error("could not read the CV");
  const summary = j.summary?.value ?? null;
  delete j.summary;
  return { profile: j as CvProfile, summary };
}

export function reviewFlags(p: Partial<CvProfile>): string[] {
  const flags: string[] = [];
  for (const [k, f] of Object.entries(p)) {
    const fld = f as Field<any> | undefined;
    if (!fld || typeof fld !== "object") continue;
    if (fld.value != null && fld.confidence < LOW_CONFIDENCE) flags.push(`check ${k.replace(/_/g, " ")}`);
  }
  if (!p.phone?.value && !p.email?.value) flags.push("no contact details");
  return flags;
}

// ---------- scoring: plain rules, every point has a reason ----------

export type ScoreLine = { label: string; points: number };

export function scoreCandidate(
  p: Partial<CvProfile>,
  opening: { role?: string | null; station?: string | null; languages_required?: string[] | null } | null
): { score: number; reasons: ScoreLine[] } {
  const r: ScoreLine[] = [];
  const add = (label: string, points: number) => r.push({ label, points });

  const ky = Number(p.kitchen_years?.value ?? NaN);
  if (!isNaN(ky)) add(`${ky} yrs in kitchens`, ky >= 3 ? 25 : ky >= 1 ? 15 : 5);
  else add("kitchen experience unclear", 0);

  const sen = String(p.seniority?.value || "");
  if (["jefe_partida", "sous_chef", "chef"].includes(sen)) add(`runs a section (${sen.replace("_", " ")})`, 10);
  else if (sen === "cocinero") add("cook", 5);

  const stations = (p.stations?.value || []).map((s) => s.toLowerCase());
  const want = (opening?.station || "").toLowerCase();
  if (want && stations.some((s) => s.includes(want) || want.includes(s))) add(`has worked ${opening?.station}`, 10);

  if (p.lives_on_island_year_round?.value === true) add("lives on the island year-round", 15);
  if (p.wants_year_round?.value === true) add("wants winter work too", 10);

  const langs = p.languages?.value || [];
  if (langs.includes("es")) add("Spanish", 10);
  if (langs.includes("en")) add("English", 5);
  for (const l of opening?.languages_required || []) {
    if (!langs.includes(l.toLowerCase().slice(0, 2))) add(`missing required language ${l}`, -10);
  }

  const rtw = String(p.right_to_work?.value || "unknown");
  if (rtw === "yes") add("right to work confirmed", 15);
  else if (rtw === "no") add("no right to work", -30);
  else add("right to work not yet confirmed", 0);

  if (p.weekends?.value === true) add("works weekends", 5);
  if (p.weekends?.value === false) add("no weekends", -15);
  if (p.references?.value) add("references offered", 5);

  const score = Math.max(0, Math.min(100, r.reduce((s, x) => s + x.points, 0)));
  return { score, reasons: r };
}

// ---------- question set: fixed SOP questions, skip what we know ----------

type Q = { key: keyof CvProfile | string; es: string; en: string; skipIf?: (p: Partial<CvProfile>) => boolean };

const QUESTIONS: Q[] = [
  { key: "right_to_work", es: "¿Tienes permiso de trabajo en España (DNI/NIE en vigor)?", en: "Do you have the right to work in Spain (valid DNI/NIE)?", skipIf: (p) => p.right_to_work?.value === "yes" && (p.right_to_work?.confidence ?? 0) >= 0.8 },
  { key: "availability", es: "¿Desde qué fecha podrías empezar y qué preaviso tienes que dar?", en: "From what date could you start, and what notice do you need to give?" },
  { key: "salary_expectation", es: "¿Qué expectativa salarial tienes (neto mensual o bruto anual)?", en: "What salary are you looking for (net monthly or gross yearly)?" },
  { key: "weekends", es: "¿Puedes trabajar fines de semana y festivos?", en: "Can you work weekends and bank holidays?" },
  { key: "transport", es: "Estamos en Sant Joan de Labritja, en el norte. ¿Dónde vives y cómo vendrías (coche, moto…)?", en: "We're in Sant Joan de Labritja, in the north. Where do you live and how would you get here?" },
  { key: "references", es: "¿Nos puedes dar el contacto de uno o dos jefes de cocina anteriores como referencia?", en: "Could you share one or two previous head chefs we can call as references?" },
  { key: "station_preference", es: "¿En qué partida te sientes más fuerte y en cuál te gustaría crecer?", en: "Which station are you strongest on, and where would you like to grow?" },
  { key: "allergen_training", es: "¿Tienes formación en alérgenos y manipulación de alimentos?", en: "Do you have allergen and food-handling training?" },
];

const PRIVACY_ES =
  "Usamos tus datos solo para este proceso de selección y los guardamos un máximo de 12 meses. Si prefieres que los borremos antes, respóndenos a este correo.";
const PRIVACY_EN =
  "We use your details only for this hiring process and keep them for at most 12 months. If you'd like us to delete them sooner, just reply to this email.";

export function buildQuestionSet(
  firstName: string,
  p: Partial<CvProfile>,
  houseName: string,
  roleLabel: string,
  intro?: { es: string; en: string } | null
): { subject: string; es: string; en: string } {
  const qs = QUESTIONS.filter((q) => !(q.skipIf && q.skipIf(p)));
  const transportFix = (s: string) =>
    houseName.toLowerCase().includes("taller") ? s.replace(/Sant Joan de Labritja, en el norte|Sant Joan de Labritja, in the north/, "Ibiza town") : s;
  const es = [
    `Hola ${firstName},`,
    "",
    intro?.es || `Gracias por escribirnos y por mandar tu CV para ${roleLabel} en ${houseName}.`,
    "Antes de quedar, unas preguntas rápidas:",
    "",
    ...qs.map((q, i) => `${i + 1}. ${transportFix(q.es)}`),
    "",
    "Con eso te propongo un día para conocernos en la cocina.",
    "",
    "Un saludo,",
    "Boris",
    "",
    PRIVACY_ES,
  ].join("\n");
  const en = [
    `Hi ${firstName},`,
    "",
    intro?.en || `Thanks for writing and sending your CV for ${roleLabel} at ${houseName}.`,
    "Before we meet, a few quick questions:",
    "",
    ...qs.map((q, i) => `${i + 1}. ${transportFix(q.en)}`),
    "",
    "With that I'll suggest a day to meet in the kitchen.",
    "",
    "Best,",
    "Boris",
    "",
    PRIVACY_EN,
  ].join("\n");
  return { subject: `${houseName} — ${roleLabel === "la cocina" ? "tu candidatura de cocina" : roleLabel}`, es, en };
}

// One short, specific opening line per candidate (ES + EN). Optional — the
// template stands on its own if the model is unavailable.
export async function personalIntro(
  summary: string | null,
  p: Partial<CvProfile>,
  houseName: string
): Promise<{ es: string; en: string } | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const facts = JSON.stringify({ summary, current_role: p.current_role?.value, stations: p.stations?.value, availability: p.availability?.value, year_round: p.wants_year_round?.value });
  try {
    const txt = await callClaude(
      [{ type: "text", text: `Candidate facts: ${facts}\nHouse: ${houseName}` }],
      `Write ONE sentence a head chef would open a reply to a job applicant with, referencing one concrete fact from their CV. Direct, warm, no flattery, no exclamation marks. Return ONLY JSON {"es": "...", "en": "..."} — es in Spanish using "tú", en in English. Start with "Gracias por…" / "Thanks for…".`,
      300
    );
    const j = stripJson(txt);
    return j?.es && j?.en ? { es: String(j.es), en: String(j.en) } : null;
  } catch {
    return null;
  }
}

// ---------- reply ingest ----------

const REPLY_SYSTEM = `A job applicant replied to our screening questions. Extract their answers. Return ONLY JSON, each key {"value": ..., "confidence": 0..1}, null when not answered:
right_to_work ("yes"|"no"|"unknown"), availability (start date + notice, short string), notice_period (string),
salary_expectation (string as they wrote it), weekends (boolean), transport (string: where they live + how they'd come),
references (string: names/contacts given, or null), station_preference (string), allergen_training (string),
lives_on_island_year_round (boolean or null).
Also "concerns": {"value": ["short phrases for anything a head chef should notice — conditions, limits, red flags"], "confidence": 1}.`;

export async function parseReply(text: string): Promise<{ answers: Partial<CvProfile>; concerns: string[] }> {
  const txt = await callClaude([{ type: "text", text }], REPLY_SYSTEM, 1000);
  const j = stripJson(txt) || {};
  const concerns: string[] = Array.isArray(j.concerns?.value) ? j.concerns.value : [];
  delete j.concerns;
  for (const k of Object.keys(j)) if (j[k]?.value == null) delete j[k];
  return { answers: j, concerns };
}

export function readyForInterview(score: number, p: Partial<CvProfile>): boolean {
  return score >= 60 && p.right_to_work?.value === "yes" && p.weekends?.value !== false;
}

export function firstName(full: string): string {
  const w = (full || "").trim().split(/\s+/)[0] || "";
  return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
}

export function retainUntil(from = new Date()): string {
  const d = new Date(from);
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
}
