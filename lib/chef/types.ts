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
  | { label: string; kind: "capture_page"; capture_id: string }  // Phase 2: photograph another page of this capture
  | { label: string; kind: "confirm"; action: ChefAction; readback: string; voice_ok?: boolean; confirm_token?: string | null }  // Phase 2: opens the read-back gate, then acts. Slice A: server-minted one-shot token the act MUST carry
  | { label: string; kind: "turn"; message: string }      // Phase 2: runs another turn ("#inbox_next")
  | { label: string; kind: "edit_reply"; id: string; author: string; draft: string }  // Phase 2: next utterance = the new reply text
  | { label: string; kind: "none" };                      // dismiss (e.g. "Looks right")

export type ChefCard = {
  title: string;                 // ≤ 60 chars
  lines: string[];               // ≤ 4 short lines
  primary?: ChefCardAction;
  chip?: ChefCardAction;         // the ONE alternative chip (confidence 0.6–0.85 on writes)
  secondary?: ChefCardAction;    // Phase 2, capture ("Add page") and inbox ("Edit") cards only — nowhere else
  entity_label?: string;         // "Bistro Mondo" — rendered as the entity chip
  href?: string;                 // tapping the card body navigates here (reads never auto-navigate)
  kind?: "read" | "write" | "confirm" | "error";
  persist?: boolean;             // stays until acted on (capture result) — no 6 s dissolve
};

// What the client posts to /api/chef/act. Every write goes through here so
// the confirm gate and undo live in ONE place.
export type ChefAction =
  | { type: "remember"; text: string; entity_id: string }
  | { type: "feedback"; text: string; page: string; feedback_kind?: "love" | "idea" | "bug" | "confusing"; entity_id: string }
  | { type: "prep_add"; entity_id: string; name: string; quantity?: number | null; unit?: string | null; station?: string | null; service_date?: string }
  | { type: "todo_add"; entity_id: string; title: string }
  | { type: "run_agent"; entity_id: string; agent_type: "research" | "build" | "write" | "pa"; objective: string; deliverables?: string[]; route?: string }
  // Phase 2
  | { type: "approve_reply"; entity_id: string; kind: "comment" | "dm"; id: string; text: string; author?: string }  // outbound: read-back + Yes (voice yes allowed)
  | { type: "skip_comment"; entity_id: string; id: string; author?: string }                                          // undoable (status back)
  | { type: "booking_update"; entity_id: string; id: string; patch: { service_time?: string; party_size?: number; service_date?: string; notes?: string }; label?: string }  // undoable
  | { type: "prep_update"; entity_id: string; id: string; patch: { quantity?: number | null; unit?: string | null; status?: string; name?: string }; label?: string }         // undoable
  | { type: "undo"; undo_token: string };

// Slice A (2026-09-26): what the client posts to /api/chef/act. The action
// plus the server-minted confirm token (outbound class only), the turn it
// came from and how the gate was resolved — so the server can consume the
// token and write chef_turns.resolution itself.
export type ChefActRequest = {
  action: ChefAction;
  language?: ChefLang;
  confirm_token?: string | null;
  turn_id?: string | null;
  via?: "tap" | "voice";
};

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
  // Phase 2 — the gate table (brief §2): a spoken "sí / yes" may resolve the
  // confirm ONLY when this is true (outbound reply, agent). Money / publish /
  // delete keep it false: tap Yes only, voice "no" still cancels.
  confirm_voice?: boolean;
  // Phase 2 — batch approve: after this confirm resolves, the client runs
  // this many more "#approve_next" turns, each with its own read-back + Yes.
  batch_remaining?: number;
  turn_id?: string | null;       // chef_turns.id
  // Slice A: one-shot token minted server-side for needs_confirm turns whose
  // action is in the outbound class (run_agent, approve_reply). /api/chef/act
  // refuses those actions (403 not_confirmed) unless it consumes this token.
  confirm_token?: string | null;
  latency_ms?: number;
  // Compat for legacy /api/ask callers (reputation draft, AssistantContext):
  reply?: string;
  configured?: boolean;
};

export const CONFIDENCE_ACT = 0.85;
export const CONFIDENCE_READ_ONLY = 0.6;

// What the client sends alongside the utterance so the server can keep the
// inbox walk stateless: ids already shown this session.
export type ChefClientState = { inbox_seen?: string[]; source?: "voice" | "typed" | "chip" | "headset"; chip_key?: string };

export function isWriteIntent(i: ChefIntent): boolean {
  return i.kind === "create" || i.kind === "update" || i.kind === "approve"
    || i.kind === "run_agent" || i.kind === "remember" || i.kind === "feedback";
}
