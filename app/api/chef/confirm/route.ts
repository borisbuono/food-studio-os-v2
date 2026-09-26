import { supabaseServer } from "@/lib/supabaseServer";
import { resolveEntityScope } from "@/lib/assistant/orchestrator";
import { getMyMembershipContext } from "@/lib/memberships";
import { mintConfirmToken, needsConfirmToken } from "@/lib/chef/confirm";
import type { ChefAction, ChefLang } from "@/lib/chef/types";
import { INBOX_TABLE } from "@/lib/social/inboxAct";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/chef/confirm — mint a confirm token for an outbound action the
// CLIENT composed (today: the inbox "Edit" flow, where the next utterance is
// the new reply text and never passes through /api/ask). The server, not the
// browser, decides the read-back, logs the turn and mints the token; the
// action still cannot execute until /api/chef/act consumes that token.
//
// Body: { action: ChefAction, language?, transcript?, route?, session_id?, source? }
// Reply: { ok, turn_id, confirm_token, readback, say, confirm_voice }

const READBACK = {
  es: (a: string, d: string) => "Respondo a " + a + ": «" + d + "». ¿Envío?",
  en: (a: string, d: string) => "Reply to " + a + ": “" + d + "”. Send it?",
};

function clip(s: string, n: number) { s = String(s || "").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; }

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const lang: ChefLang = body?.language === "es" ? "es" : "en";
  const action = body?.action as ChefAction | undefined;
  if (!action || typeof (action as any).type !== "string") return Response.json({ ok: false, error: "action required" }, { status: 400 });
  // Only the outbound class needs a token; only approve_reply can be composed client-side.
  if (!needsConfirmToken(action) || action.type !== "approve_reply") return Response.json({ ok: false, error: "not a confirmable action" }, { status: 400 });

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return Response.json({ ok: false, error: "auth" }, { status: 401 });

  const scope = await resolveEntityScope(String(action.entity_id || ""));
  if (!scope) return Response.json({ ok: false, error: "unknown entity" }, { status: 404 });
  const mem = await getMyMembershipContext();
  if (!new Set((mem.memberships || []).map((m) => m.entity_id)).has(scope.entity.id)) return Response.json({ ok: false, error: "not a member" }, { status: 403 });

  // The row must exist under RLS and not be sent already — the same checks
  // the send will make, done now so the read-back is honest.
  const table = INBOX_TABLE[action.kind === "dm" ? "dm" : "comment"];
  const { data: row } = await sb.from(table).select("id, status, author_name").eq("id", String(action.id || "")).maybeSingle();
  if (!row) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  if ((row as any).status === "replied") return Response.json({ ok: false, error: "already replied" }, { status: 409 });
  const text = clip(String(action.text || ""), 2000);
  if (!text) return Response.json({ ok: false, error: "empty reply" }, { status: 422 });
  const author = String(action.author || (row as any).author_name || "");
  const canonicalAction: ChefAction = { type: "approve_reply", entity_id: scope.entity.id, kind: action.kind === "dm" ? "dm" : "comment", id: String(action.id), text, author: author || undefined };
  const readback = READBACK[lang](author, clip(text, 240));

  // Log the turn like every intent, then bind the token to it.
  let turnId: string | null = null;
  try {
    const { data } = await sb.from("chef_turns").insert({
      user_id: uid, entity_id: scope.entity.id, route: body?.route ? String(body.route).slice(0, 200) : null,
      transcript: String(body?.transcript || text).slice(0, 4000),
      intent: { kind: "approve", surface: "social", id: String(action.id), action: "send" },
      confidence: 1, outcome: "pending_confirm", latency_ms: 0, cost_cents: 0,
      voice: body?.source === "voice", language: lang, session_id: body?.session_id ? String(body.session_id) : null,
      source: ["voice", "typed", "chip", "headset"].includes(body?.source) ? body.source : "typed", chip_key: null,
    }).select("id").maybeSingle();
    turnId = (data as any)?.id || null;
  } catch { /* log only */ }

  const confirm_token = await mintConfirmToken(sb, uid, turnId, canonicalAction);
  if (!confirm_token) return Response.json({ ok: false, error: "could not mint confirmation" }, { status: 500 });
  return Response.json({ ok: true, turn_id: turnId, confirm_token, readback, say: readback, confirm_voice: true, action: canonicalAction });
}
