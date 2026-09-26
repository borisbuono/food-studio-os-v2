// Chef v3 slice A — the server-side confirmation gate.
//
// The router DECIDES that a turn needs confirmation (needs_confirm). Until
// 2026-09-26 that was ENFORCED only in the browser: ChefRoot showed the
// read-back and posted the action after Yes, and /api/chef/act executed
// whatever it was given. Now:
//
//   /api/ask  ─► runChefTurn ─► needs_confirm turn ─► mintConfirmToken()
//                                                      (user + turn_id + sha256(action), 10 min, one shot)
//   client    ─► read-back ─► tap Yes / spoken yes ─► POST /api/chef/act { action, confirm_token, turn_id, via }
//   /api/chef/act ─► consumeConfirmToken() ─► 403 not_confirmed unless the token is
//                    ours, unused, unexpired and hashes to THIS action
//                ─► writes chef_turns.resolution = confirmed_<via> … done/failed
//
// The browser can only display a read-back; it cannot make an outbound
// action legal. Server-only module (imports supabase clients).

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChefAction, ChefTurn } from "@/lib/chef/types";

// Action types that leave the account (outbound / agent). These REQUIRE a
// consumed token. Undoable writes (prep, todo, remember, feedback, updates)
// stay on the Undo path.
export const CONFIRM_REQUIRED: ReadonlySet<ChefAction["type"]> = new Set<ChefAction["type"]>(["run_agent", "approve_reply"]);

export function needsConfirmToken(action: ChefAction | null | undefined): boolean {
  return !!action && CONFIRM_REQUIRED.has(action.type);
}

// Canonical JSON: sorted keys, undefined dropped — so the object the router
// built and the object the browser posts back hash identically.
function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonical(o[k])).join(",") + "}";
}

export function actionHash(action: ChefAction): string {
  // confirm_token / turn_id ride alongside the action on the wire; never part of the hash.
  const { confirm_token: _c, turn_id: _t, ...rest } = action as any;
  return createHash("sha256").update(canonical(rest)).digest("hex");
}

export const CONFIRM_TTL_MINUTES = 10;

export async function mintConfirmToken(sb: SupabaseClient, uid: string, turnId: string | null, action: ChefAction): Promise<string | null> {
  try {
    const { data } = await sb.from("chef_confirm_tokens").insert({
      user_id: uid, turn_id: turnId, action_type: action.type, action_hash: actionHash(action),
      expires_at: new Date(Date.now() + CONFIRM_TTL_MINUTES * 60_000).toISOString(),
    }).select("token").maybeSingle();
    return (data as any)?.token || null;
  } catch {
    return null;
  }
}

// Walk a finished turn and attach tokens to every confirm surface: the
// pending `action` (when needs_confirm) and any card button of kind
// "confirm". Identical actions share one token.
export async function attachConfirmTokens(sb: SupabaseClient, uid: string | null, turn: ChefTurn): Promise<ChefTurn> {
  if (!uid) return turn;
  const cache = new Map<string, string | null>();
  const mint = async (a: ChefAction) => {
    const h = actionHash(a);
    if (!cache.has(h)) cache.set(h, await mintConfirmToken(sb, uid, turn.turn_id || null, a));
    return cache.get(h) || null;
  };
  if (turn.needs_confirm && turn.action && needsConfirmToken(turn.action)) {
    turn.confirm_token = await mint(turn.action);
  }
  const card = turn.card;
  if (card) {
    for (const slot of ["primary", "chip", "secondary"] as const) {
      const a = card[slot];
      if (a && a.kind === "confirm" && needsConfirmToken(a.action)) {
        (a as any).confirm_token = await mint(a.action);
      }
    }
  }
  return turn;
}

export type ConsumeResult =
  | { ok: true; turn_id: string | null; via: string }
  | { ok: false; reason: "missing" | "invalid" | "expired" | "used" | "mismatch" };

export type ConfirmVia = "tap" | "voice" | "page_tick";

// One-shot: a single conditional UPDATE, so two racing posts cannot both win.
export async function consumeConfirmToken(
  sb: SupabaseClient, uid: string, token: string | null | undefined, action: ChefAction, via: ConfirmVia,
): Promise<ConsumeResult> {
  const tok = String(token || "").trim();
  if (!tok) return { ok: false, reason: "missing" };
  if (!/^[0-9a-f-]{36}$/i.test(tok)) return { ok: false, reason: "invalid" };
  const hash = actionHash(action);
  const nowIso = new Date().toISOString();
  const { data: used } = await sb.from("chef_confirm_tokens")
    .update({ used_at: nowIso, used_via: via })
    .eq("token", tok).eq("user_id", uid).eq("action_hash", hash).is("used_at", null).gt("expires_at", nowIso)
    .select("turn_id").maybeSingle();
  if (used) return { ok: true, turn_id: (used as any).turn_id || null, via };
  // Say why — the client shows "expired, ask again" vs a plain refusal.
  const { data: row } = await sb.from("chef_confirm_tokens").select("action_hash, used_at, expires_at").eq("token", tok).eq("user_id", uid).maybeSingle();
  if (!row) return { ok: false, reason: "invalid" };
  if ((row as any).used_at) return { ok: false, reason: "used" };
  if (Date.parse((row as any).expires_at) <= Date.now()) return { ok: false, reason: "expired" };
  if ((row as any).action_hash !== hash) return { ok: false, reason: "mismatch" };
  return { ok: false, reason: "invalid" };
}

// The server writes the resolution — the client no longer PATCHes
// confirmed_* / done (see /api/chef/turn).
export async function writeTurnResolution(sb: SupabaseClient, uid: string, turnId: string | null | undefined, resolution: string, result?: string | null) {
  if (!turnId) return;
  try {
    const patch: Record<string, unknown> = { resolution, resolved_at: new Date().toISOString() };
    if (result != null) patch.result = String(result).slice(0, 200);
    await sb.from("chef_turns").update(patch).eq("id", turnId).eq("user_id", uid);
  } catch { /* log only */ }
}

// The inbox page tick has no read-back turn; it mints and consumes in one
// step so every approved_by_boris=true still has a token row behind it and
// approval flows through exactly one code path (confirmApproval below).
export async function mintAndConsumePageTick(sb: SupabaseClient, uid: string, action: ChefAction): Promise<string | null> {
  const token = await mintConfirmToken(sb, uid, null, action);
  if (!token) return null;
  const r = await consumeConfirmToken(sb, uid, token, action, "page_tick");
  return r.ok ? token : null;
}
