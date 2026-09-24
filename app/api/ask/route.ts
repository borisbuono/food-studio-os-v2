import { supabaseServer } from "@/lib/supabaseServer";
import { resolveEntityScope } from "@/lib/assistant/orchestrator";
import { E_BM, E_HOLDINGS, type EntityKey } from "@/lib/entities";
import { houseSlugForEntity } from "@/lib/houses";
import { getMyMembershipContext } from "@/lib/memberships";
import { runChefTurn } from "@/lib/chef/router";
import type { ChefLang, ChefTurn } from "@/lib/chef/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// /api/ask — Chef v3 Phase 1. One turn in, one ChefTurn out.
//
// Inputs are unchanged from v2 (message, route, session_id, entity_id,
// language, page_context) plus `voice` and `house`. The response is the
// ChefTurn contract from lib/chef/types.ts with two compat fields kept for
// the legacy callers (reputation draft reads `reply`, the old FAB reads
// `configured`): `reply` is the full answer for a free-form question, else
// the spoken `say`.
//
// Scope resolution and the membership refusal are exactly as before — the
// fs_entity cookie is user-tamperable, so an unknown entity or a non-member
// is refused rather than coerced to a default tenant.

function refusal(message: string, language: ChefLang, reply: string, configured = true): ChefTurn {
  return {
    transcript: message, language,
    intent: { kind: "clarify", question: reply },
    confidence: 0, say: reply.split(/\s+/).slice(0, 12).join(" "),
    card: { title: language === "es" ? "Chef" : "Chef", lines: [reply], kind: "error" },
    needs_confirm: false, reply, configured,
  };
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const message = String(body?.message || "").slice(0, 4000);
  const route = String(body?.route || "");
  const sessionId = String(body?.session_id || "") || null;
  // Legacy callers (reputation draft, AssistantContext) send no entity_id;
  // they only ever READ. The v3 control always sends one. A defaulted scope
  // is passed through as an empty entityId so the router refuses writes
  // (brief §7: never guess E_BM for a write).
  const scopeDefaulted = !body?.entity_id;
  const entityRaw = String(body?.entity_id || E_BM);
  const pageContext = body?.page_context || null;
  const language = (body?.language === "es" ? "es" : "en") as ChefLang;
  const voice = body?.voice === true;
  const houseIn = typeof body?.house === "string" && body.house ? String(body.house).toLowerCase() : null;

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const uid = u.user?.id || null;

  const scope = await resolveEntityScope(entityRaw);
  if (!scope) {
    return Response.json(refusal(message, language,
      language === "es" ? "No encuentro esa casa en el OS. Vuelve a entrar o elige una en el selector." : "I can't find that venue in the OS. Sign in again or pick a venue from the switcher."));
  }

  if (uid) {
    const mem = await getMyMembershipContext();
    const memberOf = new Set((mem.memberships || []).map((m) => m.entity_id));
    if (!memberOf.has(scope.entity.id)) {
      return Response.json(refusal(message, language,
        (language === "es" ? "No eres miembro de " : "You're not a member of ") + (scope.entity.name || "this venue") + (language === "es" ? ". Elige una de tus casas en el selector." : ". Pick one of your own venues from the switcher.")));
    }
  }

  // Without a key the deterministic paths still work; the model paths
  // degrade to a clarify that says so.
  const configured = !!process.env.ANTHROPIC_API_KEY;
  // Holdings is the Studio, not a house — it has no /h/<slug> routes.
  const houseSlug = scope.entity.id === E_HOLDINGS ? null
    : (houseIn || scope.entity.slug || houseSlugForEntity(scope.entity.id as EntityKey) || null);

  const turn = await runChefTurn({
    message, route, sessionId, entityId: scopeDefaulted ? "" : scope.entity.id, language, pageContext, uid, voice, scope, houseSlug,
  });

  // Deterministic turns (navigate, capture, pending writes) never needed the
  // model; only the model-backed ones report "not configured".
  if (!configured && !turn.navigate && !turn.action) {
    const reply = "I've captured that — the assistant isn't switched on yet (needs ANTHROPIC_API_KEY).";
    const clarified: ChefTurn = { ...turn, intent: { kind: "clarify", question: reply }, confidence: 0, say: reply.split(/\s+/).slice(0, 12).join(" ") };
    return Response.json({ ...clarified, configured: false, reply });
  }

  const reply = turn.reply ?? turn.say;
  return Response.json({ ...turn, reply, configured: true });
}
