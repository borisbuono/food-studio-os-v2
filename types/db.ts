// Focused types for the menu spine.
export type MenuItem = {
  id: string;
  restaurant_id: string | null;
  recipe_id: string | null;
  name: string;
  section: string | null;
  price: number | null;
  cost: number | null;
  description: string | null;
  is_active: boolean | null;
  is_eighty_six: boolean | null;
  is_special: boolean | null;
  beverage_type: string | null;
  category: string | null;
  course: string | null;
  wine_style: string | null;
};

// -------------------------------------------------------------------------
// Assistant Layer tables (renamed from chef_* in Sprint 1, 2026-07-07).
// -------------------------------------------------------------------------

export type AssistantConversation = {
  id: string;
  user_id: string | null;
  entity_id: string | null;
  route: string | null;
  session_id: string | null;
  turn_role: "user" | "assistant" | "sys";
  text: string | null;
  intent: string | null;
  confidence: number | null;
  did_action: any | null;
  created_at: string;
};

export type AssistantMemoryRow = {
  id: string;
  user_id: string | null;
  fact: string;
  scope: string | null;
  source_conversation_id: string | null;
  confidence: number | null;
  confirmed_at: string | null;
  retired_at: string | null;
  created_at: string;
};

export type AssistantActionRow = {
  id: string;
  user_id: string | null;
  conversation_id: string | null;
  action_type: string;
  target_table: string | null;
  target_id: string | null;
  payload: any | null;
  reversible: boolean;
  undone_at: string | null;
  created_at: string;
};

export type AssistantIntent = {
  id: string;
  user_id: string | null;
  text: string;
  classified_intent: string | null;
  confirmed_intent: string | null;
  classifier_confidence: number | null;
  language: string | null;
  created_at: string;
};

export type AssistantConfigRow = {
  id: string;
  entity_code: "IFL" | "BM" | "BBH";
  voice_profile: string | null;
  personality_dials: { formality: number; warmth: number; brevity: number };
  timezone: string;
  working_hours: Record<string, { start: string; end: string }>;
  quiet_hours: { start: string; end: string };
  created_at: string;
  updated_at: string;
};

export type AssistantChannelRow = {
  id: string;
  user_id: string;
  channel_type: "gmail" | "whatsapp_personal" | "whatsapp_business";
  account_ref: string;
  auth_ref: string | null;
  settings: { triage_enabled?: boolean; auto_draft?: boolean; supervised_send?: boolean; auto_send?: boolean; quiet_hours_override?: boolean; entity_code?: 'IFL' | 'BM' | 'BBH'; desktop_assist?: boolean };
  created_at: string;
  revoked_at: string | null;
};

export type AssistantPlaybookRow = {
  id: string;
  entity_code: "IFL" | "BM" | "BBH";
  name: string;
  description: string | null;
  priority: number;
  triage_rules: Array<{ match: any; action: any }>;
  created_at: string;
  updated_at: string;
};

export type AssistantBriefRow = {
  id: string;
  entity_code: "IFL" | "BM" | "BBH";
  user_id: string | null;
  date: string;
  body: string | null;
  created_at: string;
};
