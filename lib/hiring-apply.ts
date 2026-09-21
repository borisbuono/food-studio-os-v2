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
  note: string;
};

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
