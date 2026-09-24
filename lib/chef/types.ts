// Chef v3 — the typed contract between the control (client), the intent
// router (/api/ask) and the action executor (/api/chef/act).
//
// Source of truth: 06_PA/_INBOX/TO_BORIS_chef_v3_foundation_brief_2026-09-24.md
// Part 2 §2 (schema) and §2 gate table. The model classifies; the code
// decides. Nothing in this file imports React or Supabase — it is shared by
// server routes and client components.

export type ChefLang = "es" | "en";

export type ChefSurface =
  | "recipes" | "prep" | "menu" | "calendar" | "bookings" | "inbox"
  | "social" | "hiring" | "eod" | "finance" | "team" | "files";

export type ChefScope = { entity_id: string; house?: string; room?: string };

export type ChefIntent =
  | { kind: "navigate"; to: string; args?: Record<string, string> }
  | { kind: "query"; surface: ChefSurface | "ask"; q: string; scope: ChefScope }
  | { kind: "create"; surface: ChefSurface; draft: Record<string, unknown>; scope: ChefScope }
  | { kind: "update"; surface: ChefSurface; id: string; patch: Record<string, unknown>; undoable: boolean }
  | { kind: "capture"; type: "delivery_note" | "invoice" | "wine" | "auto" }
  | { kind: "approve"; surface: "inbox" | "social" | "hiring" | "finance"; id: string; action: "send" | "post" | "pay" | "reject" }
  | { kind: "run_agent"; agent_type: "research" | "build" | "write" | "pa"; objective: string; deliverables?: string[] }
  | { kind: "remember"; text: string }
  | { kind: "feedback"; text: string; page: string; feedback_kind?: "love" | "idea" | "bug" | "confusing" }
  | { kind: "clarify"; question: string };

export type ChefIntentKind = ChefIntent["kind"];

// A result card. ≤ 4 lines, one primary action, at most one chip, entity chip.
export type ChefCardAction =
  | { label: string; kind: "navigate"; href: string }
  | { label: string; kind: "act"; action: ChefAction }   // posts to /api/chef/act
  | { label: string; kind: "none" };

export type ChefCard = {
  title: string;                 // ≤ 60 chars
  lines: string[];               // ≤ 4 short lines
  primary?: ChefCardAction;
  chip?: ChefCardAction;         // the ONE alternative chip (confidence 0.6–0.85 on writes)
  entity_label?: string;         // "Bistro Mondo" — rendered as the entity chip
  href?: string;                 // tapping the card body navigates here (reads never auto-navigate)
  kind?: "read" | "write" | "confirm" | "error";
};

// What the client posts to /api/chef/act. Every write goes through here so
// the confirm gate and undo live in ONE place.
export type ChefAction =
  | { type: "remember"; text: string; entity_id: string }
  | { type: "feedback"; text: string; page: string; feedback_kind?: "love" | "idea" | "bug" | "confusing"; entity_id: string }
  | { type: "prep_add"; entity_id: string; name: string; quantity?: number | null; unit?: string | null; station?: string | null; service_date?: string }
  | { type: "todo_add"; entity_id: string; title: string }
  | { type: "run_agent"; entity_id: string; agent_type: "research" | "build" | "write" | "pa"; objective: string; deliverables?: string[]; route?: string }
  | { type: "undo"; undo_token: string };

export type ChefActResult = {
  ok: boolean;
  error?: string;
  card?: ChefCard;
  undo_token?: string | null;    // present on undoable writes; valid 10 s client-side, 24 h server-side
  navigate?: string | null;
};

export type ChefTurn = {
  transcript: string;            // what was heard, locked
  language: ChefLang;
  intent: ChefIntent;
  confidence: number;            // 0–1
  say: string;                   // ≤ 12 words, spoken / card title
  card?: ChefCard;
  needs_confirm: boolean;        // true for every WRITE unless undoable
  readback?: string;             // the sentence shown before a confirmed write
  alternatives?: ChefIntent[];   // ≤ 2, chips when confidence < 0.75
  // Pending write for the client to post to /api/chef/act — either after the
  // user taps Yes (needs_confirm) or immediately with Undo (undoable).
  action?: ChefAction | null;
  undoable?: boolean;
  navigate?: string | null;      // only set for intent.kind === "navigate" (or "open …")
  turn_id?: string | null;       // chef_turns.id
  latency_ms?: number;
  // Compat for legacy /api/ask callers (reputation draft, AssistantContext):
  reply?: string;
  configured?: boolean;
};

export const CONFIDENCE_ACT = 0.85;
export const CONFIDENCE_READ_ONLY = 0.6;

export function isWriteIntent(i: ChefIntent): boolean {
  return i.kind === "create" || i.kind === "update" || i.kind === "approve"
    || i.kind === "run_agent" || i.kind === "remember" || i.kind === "feedback";
}
