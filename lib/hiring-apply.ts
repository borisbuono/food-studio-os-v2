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
  schedule: "full" | "extras" | "";
  food_handler: "yes" | "no" | "expired" | "";
  craft1: string;
  craft2: string;
  p_hard: string;
  p_love: string;
  p_mirror: string;
  p_curious: string;
  p_team: string;
  p_why: string;
  p_proud: string;
  work_style: Record<string, "a" | "b">;
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
  p_why: "",
  p_proud: "",
  work_style: {},
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


// Work style: ten quick either/or taps. Not a test and no type label —
// it maps how someone likes to work so a team can be balanced on purpose.
export const WORK_STYLE: Array<{ k: string; dim: { es: string; en: string }; a: { es: string; en: string }; b: { es: string; en: string } }> = [
  { k: "plan", dim: { es: "Organización", en: "Organisation" }, a: { es: "Me gusta tenerlo todo planificado", en: "I like everything planned" }, b: { es: "Me adapto sobre la marcha", en: "I adapt as I go" } },
  { k: "pace", dim: { es: "Ritmo", en: "Pace" }, a: { es: "Prefiero hacer pocas cosas perfectas", en: "I'd rather do a few things perfectly" }, b: { es: "Prefiero sacar mucho volumen bien", en: "I'd rather push a lot of volume well" } },
  { k: "lead", dim: { es: "En el equipo", en: "In the team" }, a: { es: "Suelo tomar la iniciativa y tirar del grupo", en: "I tend to take the lead" }, b: { es: "Prefiero apoyar y hacer muy bien mi parte", en: "I'd rather support and nail my part" } },
  { k: "energy", dim: { es: "Energía", en: "Energy" }, a: { es: "El ruido y la gente me dan energía", en: "Noise and people give me energy" }, b: { es: "Rindo mejor en calma y concentrado/a", en: "I work best calm and focused" } },
  { k: "speak", dim: { es: "Cuando algo no va", en: "When something's off" }, a: { es: "Lo digo en el momento", en: "I say it there and then" }, b: { es: "Espero el momento adecuado para hablarlo", en: "I wait for the right moment to raise it" } },
  { k: "novelty", dim: { es: "Rutina", en: "Routine" }, a: { es: "Me gusta una rutina bien hecha", en: "I like a routine done well" }, b: { es: "Me aburro si no hay cosas nuevas", en: "I get bored without new things" } },
  { k: "pressure", dim: { es: "Bajo presión", en: "Under pressure" }, a: { es: "Me crezco", en: "I rise to it" }, b: { es: "Necesito un plan claro para rendir", en: "I need a clear plan to perform" } },
  { k: "autonomy", dim: { es: "Instrucciones", en: "Instructions" }, a: { es: "Prefiero que me digan exactamente qué hacer", en: "Tell me exactly what to do" }, b: { es: "Dame el objetivo y déjame hacerlo a mi manera", en: "Give me the goal and let me do it my way" } },
  { k: "learn", dim: { es: "Aprendo", en: "I learn" }, a: { es: "Mirando y repitiendo", en: "By watching and repeating" }, b: { es: "Entendiendo el porqué", en: "By understanding the why" } },
  { k: "stay", dim: { es: "Trayectoria", en: "Path" }, a: { es: "Me gusta quedarme años en un sitio", en: "I like to stay somewhere for years" }, b: { es: "Me gusta cambiar y conocer sitios", en: "I like moving on and seeing new places" } },
];

export const EXTRA_PERSON_Q = {
  p_why: { es: "¿Por qué nosotros? ¿Qué te llama de este sitio?", en: "Why us? What draws you to this place?" },
  p_proud: { es: "Algo de lo que estés orgulloso/a, dentro o fuera del trabajo.", en: "Something you're proud of, at work or outside it." },
};

export function workStyleLines(ws: Record<string, "a" | "b"> | undefined, lang: "es" | "en" = "es"): string[] {
  return WORK_STYLE.filter((w) => ws?.[w.k]).map((w) => `${w.dim[lang]}: ${(ws![w.k] === "a" ? w.a : w.b)[lang]}`);
}
