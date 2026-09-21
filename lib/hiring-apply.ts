import { createClient, type SupabaseClient } from "@supabase/supabase-js";
// Shared by the public apply page and its API route.
export const APPLY_CONTACT: Record<string, string> = {
  bm: "info@bistro-mondo.com",
  taller: "info@ibzfoodstudio.com",
};

export type ApplyArea = "cocina" | "sala";
export type ApplyKind = "job" | "stage_1d" | "stage_3d" | "stage_1w";
export const KIND_LABEL: Record<ApplyKind, { es: string; en: string }> = {
  job: { es: "Trabajo", en: "Job" },
  stage_1d: { es: "Stage 1 día", en: "Stage 1 day" },
  stage_3d: { es: "Stage 3 días", en: "Stage 3 days" },
  stage_1w: { es: "Stage 1 semana", en: "Stage 1 week" },
};

export type ApplyAnswers = {
  area: ApplyArea | "";
  kind: ApplyKind | "";
  stage_dates: string;
  right_to_work: "yes" | "no" | "in_progress" | "";
  start_date: string;
  notice: string;
  salary: string;
  weekends: "yes" | "no" | "some" | "";
  lives_where: string;
  transport: string;
  references: string;
  station: string;
  allergen_training: "yes" | "no" | "";
  schedule: "full" | "part" | "season" | "";
  food_handler: "yes" | "no" | "expired" | "";
  craft1: string;
  craft2: string;
  p_hard: string;
  p_love: string;
  p_mirror: string;
  p_curious: string;
  p_team: string;
  note: string;
};

// The person, not the paperwork. Open, quick to answer — one sentence is
// fine. Only the first question depends on kitchen / front of house.
export const SIGNATURE_Q = {
  cocina: {
    es: "¿Qué plato te representa como cocinero/a, y por qué?",
    en: "Which dish says the most about you as a cook, and why?",
  },
  sala: {
    es: "¿Qué hace que una mesa se vaya feliz?",
    en: "What makes a table leave happy?",
  },
};

export const PERSON_Q: Array<{ k: "p_hard" | "p_love" | "p_mirror" | "p_curious" | "p_team"; es: (area: string) => string; en: (area: string) => string }> = [
  { k: "p_mirror", es: () => "¿Cómo te describirían tus compañeros en tres palabras?", en: () => "How would your colleagues describe you in three words?" },
  { k: "p_hard", es: () => "Un día de mucho lío: ¿cómo lo vives y qué haces?", en: () => "A really busy, messy day: how does it feel for you, and what do you do?" },
  { k: "p_team", es: () => "¿Qué tipo de equipo saca lo mejor de ti, y qué te quema?", en: () => "What kind of team brings out your best — and what burns you out?" },
  { k: "p_curious", es: () => "¿Qué te gustaría aprender ahora mismo?", en: () => "What would you love to learn right now?" },
  { k: "p_love", es: () => "Fuera del trabajo, ¿qué te mueve?", en: () => "Outside work, what drives you?" },
];

export const EMPTY_ANSWERS: ApplyAnswers = {
  area: "",
  kind: "",
  stage_dates: "",
  right_to_work: "",
  start_date: "",
  notice: "",
  salary: "",
  weekends: "",
  lives_where: "",
  transport: "",
  references: "",
  station: "",
  allergen_training: "",
  schedule: "",
  food_handler: "",
  craft1: "",
  craft2: "",
  p_hard: "",
  p_love: "",
  p_mirror: "",
  p_curious: "",
  p_team: "",
  note: "",
};

// Anon, session-less client for the public apply surface. It can only call the
// apply_* SECURITY DEFINER functions and upload one CV per live submission —
// no service-role key involved. Server-side use only.
let anonClient: SupabaseClient | null = null;
export function applyClient(): SupabaseClient {
  if (!anonClient)
    anonClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: "fs-apply" },
    });
  return anonClient;
}

export type ApplyPageInfo = {
  id: string;
  name: string;
  legal_name: string;
  accent: string | null;
  openings: Array<{ id: string; title: string; station: string | null; role: string | null; languages_required: string[] | null }>;
};
