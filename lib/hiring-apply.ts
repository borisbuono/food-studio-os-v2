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

// Layer 2 (craft) and layer 3 (the person). Open text on purpose: a short
// written answer shows depth that a multiple-choice tick never does.
export const CRAFT_Q = {
  cocina: {
    es: [
      "Merengue italiano: explícanos cómo lo haces, paso a paso, y qué suele salir mal.",
      "Un fondo oscuro o una demi-glace: ¿cómo lo haces, cuánto tiempo y por qué?",
    ],
    en: [
      "Italian meringue: walk us through how you make it, step by step, and what usually goes wrong.",
      "A brown stock or demi-glace: how do you make it, how long does it take, and why?",
    ],
  },
  sala: {
    es: [
      "Una mesa de cuatro quiere vino y no sabe qué pedir. ¿Cómo lo llevas, de la primera frase a la botella en la mesa?",
      "La cocina va con 20 minutos de retraso y una mesa empieza a quejarse. ¿Qué haces?",
    ],
    en: [
      "A table of four wants wine and has no idea what to order. How do you handle it, from your first sentence to the bottle on the table?",
      "The kitchen is 20 minutes behind and a table starts to complain. What do you do?",
    ],
  },
};

export const PERSON_Q: Array<{ k: "p_hard" | "p_love" | "p_mirror" | "p_curious" | "p_team"; es: (area: string) => string; en: (area: string) => string }> = [
  { k: "p_hard", es: () => "Cuéntanos un servicio que se torció. ¿Qué pasó y qué hiciste tú?", en: () => "Tell us about a service that went wrong. What happened, and what did you do?" },
  { k: "p_love", es: (a) => `¿Qué es lo que más te gusta de trabajar en ${a === "sala" ? "sala" : "cocina"}?`, en: (a) => `What do you love most about working ${a === "sala" ? "front of house" : "in a kitchen"}?` },
  { k: "p_mirror", es: () => "¿Qué dirían de ti tus compañeros? ¿Y qué te dirían que mejores?", en: () => "What would your colleagues say about you? And what would they tell you to work on?" },
  { k: "p_curious", es: () => "¿Qué has aprendido, probado o cocinado por tu cuenta este último año?", en: () => "What have you learned, tasted or cooked on your own this past year?" },
  { k: "p_team", es: () => "¿Qué tipo de equipo saca lo mejor de ti, y qué te quema?", en: () => "What kind of team brings out your best — and what burns you out?" },
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
