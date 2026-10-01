// lib/cleaning/types.ts — the cleaning module's shared shapes (S1, 2026-10-02).
// No React, no Supabase: used by API routes and client components alike.

export type CleaningFrequency = "daily" | "weekly" | "monthly" | "opening" | "closing";
export type CleaningShift = "opening" | "closing" | "daily" | "weekly" | "monthly";
export type CleaningItemKind = "task" | "temp" | "corrective";

export type CleaningTemplateItem = {
  label: string;
  order: number;
  kind?: CleaningItemKind;
  // temp items (S2): the equipment and its band
  equipment?: string;
  equipment_type?: "fridge" | "freezer" | "hot_hold" | "other";
  min_c?: number | null;
  max_c?: number | null;
};

export type CleaningTemplate = {
  id: string;
  entity_id: string;
  name: string;
  area: string | null;
  frequency: CleaningFrequency;
  weekday: number | null;   // ISO 1 = Mon … 7 = Sun
  items: CleaningTemplateItem[];
  active: boolean;
  sort_order: number;
  metadata: Record<string, unknown>;
};

export type CleaningRunItem = {
  id: string;
  run_id: string;
  entity_id: string;
  label: string;
  sort_order: number;
  kind: CleaningItemKind;
  done: boolean;
  done_by: string | null;
  done_by_name: string | null;
  done_at: string | null;
  note: string | null;
  // S2 (temps)
  equipment_name?: string | null;
  equipment_type?: string | null;
  target_min_c?: number | null;
  target_max_c?: number | null;
  temperature_c?: number | null;
  in_range?: boolean | null;
  temp_log_id?: string | null;
};

export type CleaningRun = {
  id: string;
  entity_id: string;
  template_id: string | null;
  template_name: string;
  area: string | null;
  service_date: string;
  shift: CleaningShift;
  status: "open" | "signed";
  signed_by: string | null;
  signed_by_name: string | null;
  signed_at: string | null;
  items: CleaningRunItem[];
};

export const SHIFT_ORDER: CleaningShift[] = ["opening", "daily", "weekly", "monthly", "closing"];

export const WEEKDAYS: Record<"en" | "es", string[]> = {
  en: ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
  es: ["", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"],
};
