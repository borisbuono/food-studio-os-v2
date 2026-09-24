import { supabaseServer } from "@/lib/supabaseServer";
import { codeForEntityId, resolveEntityScope } from "@/lib/assistant/orchestrator";
import { ENTITY_TO_RESTAURANT, type EntityKey } from "@/lib/entities";
import { getMyMembershipContext } from "@/lib/memberships";
import type { ChefAction, ChefActResult, ChefCard, ChefLang } from "@/lib/chef/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/chef/act — the ONE place Chef writes.
//
// Every ChefAction the router hands back lands here: undoable writes
// (remember, feedback, prep_add, todo_add) insert a row and a chef_undo
// token; run_agent creates the charter and queues a PA inbox note (the
// request leaves the account, so it is written down for the PA runner, not
// executed in-app); undo consumes a token and deletes the row it points at.

const T = {
  es: {
    remember: "Apuntado", feedback: "Feedback guardado", prep: "Añadido a la mise de hoy",
    todo: "Tarea creada", agent: "Agente encargado", undone: "Deshecho",
    undo_bad: "Ese deshacer ya no vale", not_member: "No eres miembro de esa casa",
    no_entity: "No encuentro esa casa", nothing_deleted: "No se pudo deshacer (sin permiso)",
    note_queued: "Nota para la PA en cola",
  },
  en: {
    remember: "Noted", feedback: "Feedback saved", prep: "Added to today's prep",
    todo: "Task created", agent: "Agent briefed", undone: "Undone",
    undo_bad: "That undo is no longer valid", not_member: "You're not a member of that house",
    no_entity: "I can't find that house", nothing_deleted: "Could not undo (no permission)",
    note_queued: "PA inbox note queued",
  },
} as const;

const UNDO_TABLES = new Set(["assistant_memory", "feedback", "prep_lists", "master_todos", "agent_charters"]);
const AGENT_TAG: Record<string, string> = { research: "RESEARCH", build: "OS", write: "MARKETING", pa: "PA" };

function madridToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function slugify(s: string) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "task";
}
function clip(s: string, n: number) { s = String(s || "").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; }
function card(title: string, lines: string[], entity_label?: string, kind: ChefCard["kind"] = "write"): ChefCard {
  return { title: clip(title, 60), lines: lines.slice(0, 4), kind, entity_label };
}
function fail(error: string, status = 400) {
  const r: ChefActResult = { ok: false, error };
  return Response.json(r, { status });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const lang: ChefLang = body?.language === "es" ? "es" : "en";
  const t = T[lang];
  const action = (body?.action && typeof body.action === "object" ? body.action : body) as ChefAction;
  if (!action || typeof (action as any).type !== "string") return fail("action required");

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return fail("auth", 401);

  // ---------------------------------------------------------------- undo
  if (action.type === "undo") {
    const token = String(action.undo_token || "");
    if (!token) return fail("undo_token required");
    const { data: row } = await sb.from("chef_undo").select("token, user_id, table_name, row_id, used_at, expires_at")
      .eq("token", token).eq("user_id", uid).maybeSingle();
    if (!row || (row as any).used_at || Date.parse((row as any).expires_at) < Date.now() || !UNDO_TABLES.has((row as any).table_name))
      return fail(t.undo_bad, 410);
    const { data: gone, error } = await sb.from((row as any).table_name).delete().eq("id", (row as any).row_id).select("id");
    if (error) return fail(error.message, 500);
    // RLS can silently delete nothing (e.g. a non-manager on prep_lists) —
    // say so instead of pretending.
    if (!gone || !gone.length) return fail(t.nothing_deleted, 403);
    await sb.from("chef_undo").update({ used_at: new Date().toISOString() }).eq("token", token);
    const r: ChefActResult = { ok: true, card: card(t.undone, [], undefined, "write") };
    return Response.json(r);
  }

  // ---------------------------------------------------------------- scope + membership
  const entityId = String((action as any).entity_id || "");
  const scope = await resolveEntityScope(entityId);
  if (!scope) return fail(t.no_entity, 404);
  const mem = await getMyMembershipContext();
  if (!new Set((mem.memberships || []).map((m) => m.entity_id)).has(scope.entity.id)) return fail(t.not_member, 403);
  const label = scope.entity.name;
  const code = codeForEntityId(scope.entity.id);

  const undoFor = async (table: string, rowId: string): Promise<string | null> => {
    const { data } = await sb.from("chef_undo").insert({
      user_id: uid, table_name: table, row_id: rowId,
      expires_at: new Date(Date.now() + 24 * 3600_000).toISOString(),
    }).select("token").maybeSingle();
    return (data as any)?.token || null;
  };
  const done = async (table: string, rowId: string, c: ChefCard, navigate?: string | null) => {
    const undo_token = await undoFor(table, rowId);
    const r: ChefActResult = { ok: true, card: c, undo_token, navigate: navigate ?? null };
    return Response.json(r);
  };

  switch (action.type) {
    case "remember": {
      const text = clip(action.text, 600);
      if (!text) return fail("text required");
      const { data, error } = await sb.from("assistant_memory").insert({
        user_id: uid, fact: text, scope: "global", entity_code: code, confidence: null, source_conversation_id: null,
      }).select("id").maybeSingle();
      if (error || !data) return fail(error?.message || "insert failed", 500);
      return done("assistant_memory", (data as any).id, card(t.remember, [text], label));
    }
    case "feedback": {
      const text = clip(action.text, 2000);
      if (!text) return fail("text required");
      const kinds = ["love", "idea", "bug", "confusing"];
      const kind = kinds.includes(String(action.feedback_kind)) ? action.feedback_kind : "idea";
      // author_id FKs profiles and RLS needs it — same as save-feedback.
      const { data: prof } = await sb.from("profiles").select("id,name,role,restaurant_id").eq("id", uid).maybeSingle();
      if (!prof) return fail("no profile", 403);
      const restaurantId = ENTITY_TO_RESTAURANT[scope.entity.id as EntityKey] || (prof as any).restaurant_id || null;
      const { data, error } = await sb.from("feedback").insert({
        restaurant_id: restaurantId, route: clip(action.page || "", 200) || null,
        author_id: uid, author_name: (prof as any).name || null, author_role: (prof as any).role || null,
        kind, body: text, metadata: { source: "chef_v3", entity_id: scope.entity.id },
      }).select("id").maybeSingle();
      if (error || !data) return fail(error?.message || "insert failed", 500);
      return done("feedback", (data as any).id, card(t.feedback, [text], label));
    }
    case "prep_add": {
      const name = clip(action.name, 120);
      if (!name) return fail("name required");
      const service_date = /^\d{4}-\d{2}-\d{2}$/.test(String(action.service_date || "")) ? String(action.service_date) : madridToday();
      const { data, error } = await sb.from("prep_lists").insert({
        entity_id: scope.entity.id, service_date, name,
        quantity: action.quantity ?? null, unit: action.unit ?? null, station: action.station ?? null, status: "todo",
      }).select("id").maybeSingle();
      if (error || !data) return fail(error?.message || "insert failed", 500);
      const line = [action.quantity, action.unit, name].filter((x) => x != null && x !== "").join(" ");
      return done("prep_lists", (data as any).id, card(t.prep, [line, service_date], label));
    }
    case "todo_add": {
      const title = clip(action.title, 500);
      if (!title) return fail("title required");
      // master_todos.status is CHECK-constrained; 'pending' is the open state.
      const { data, error } = await sb.from("master_todos").insert({
        entity_code: code, title, source: "from_conversation", status: "pending",
        priority: 3, impact_score: 3, created_by_user_id: uid,
        context: { source: "chef_v3", entity_id: scope.entity.id },
      }).select("id").maybeSingle();
      if (error || !data) return fail(error?.message || "insert failed", 500);
      return done("master_todos", (data as any).id, card(t.todo, [title], label));
    }
    case "run_agent": {
      const objective = clip(action.objective, 5000);
      if (!objective) return fail("objective required");
      const agent_type = ["research", "build", "write", "pa"].includes(action.agent_type) ? action.agent_type : "research";
      const deliverables = Array.isArray(action.deliverables) ? action.deliverables : [];
      const { data: ch, error } = await sb.from("agent_charters").insert({
        entity_code: code, agent_type, objective, scope: label,
        constraints: null, success_criteria: null,
        deliverables: deliverables.map((d) => ({ type: "note", description: String(d) })),
        related_todo_id: null, status: "ready", spawned_by_user_id: uid,
      }).select("id").maybeSingle();
      if (error || !ch) return fail(error?.message || "charter insert failed", 500);
      const charterId = (ch as any).id as string;

      const date = madridToday();
      const slug = slugify(objective);
      const filename = "TO_" + (AGENT_TAG[agent_type] || "RESEARCH") + "_" + slug + "_" + date + ".md";
      const who = (u.user?.email || uid);
      const body_md = [
        "# " + objective,
        "",
        "**Date:** " + date,
        "**Scope:** " + label,
        "**Agent:** " + agent_type,
        "**Charter:** " + charterId,
        "**Asked by:** " + who + " (via Chef, from " + (action.route || "/") + ")",
        "",
        "## Objective",
        "",
        objective,
        "",
        "## Deliverables",
        "",
        ...(deliverables.length ? deliverables.map((d) => "- " + String(d)) : ["- A short written answer with sources, ready for Boris to act on."]),
        "",
        "## Report back",
        "",
        "Report back as `TO_BORIS_" + slug + "_" + date + ".md` in `06_PA/_INBOX/`.",
        "",
      ].join("\n");
      // The note is best-effort: the charter is the record, the note is the courier.
      await sb.from("pa_inbox_notes").insert({ filename, body_md, status: "pending", charter_id: charterId, entity_id: scope.entity.id, created_by: uid });
      return done("agent_charters", charterId, card(t.agent, [clip(objective, 140), filename, t.note_queued], label, "confirm"));
    }
    default:
      return fail("unknown action type");
  }
}
