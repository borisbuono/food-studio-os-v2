import { supabaseServer } from "@/lib/supabaseServer";
import { codeForEntityId, resolveEntityScope } from "@/lib/assistant/orchestrator";
import { ENTITY_TO_RESTAURANT, type EntityKey } from "@/lib/entities";
import { getMyMembershipContext } from "@/lib/memberships";
import type { ChefAction, ChefActResult, ChefCard, ChefLang } from "@/lib/chef/types";
import { approveAndSend } from "@/lib/social/inboxAct";

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
    sent: (a: string) => "Enviado a " + a, send_failed: "No se ha enviado", skipped: (a: string) => "Saltado " + a,
    booking: "Reserva actualizada", prep_upd: "Mise actualizada", not_found: "No encuentro esa fila",
  },
  en: {
    remember: "Noted", feedback: "Feedback saved", prep: "Added to today's prep",
    todo: "Task created", agent: "Agent briefed", undone: "Undone",
    undo_bad: "That undo is no longer valid", not_member: "You're not a member of that house",
    no_entity: "I can't find that house", nothing_deleted: "Could not undo (no permission)",
    note_queued: "PA inbox note queued",
    sent: (a: string) => "Sent to " + a, send_failed: "Not sent", skipped: (a: string) => "Skipped " + a,
    booking: "Booking updated", prep_upd: "Prep updated", not_found: "Can't find that row",
  },
} as const;

const UNDO_TABLES = new Set(["assistant_memory", "feedback", "prep_lists", "master_todos", "agent_charters", "invoice_inbox", "bookings", "social_comments"]);
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
    const { data: row } = await sb.from("chef_undo").select("token, user_id, table_name, row_id, used_at, expires_at, op, before, storage_path")
      .eq("token", token).eq("user_id", uid).maybeSingle();
    if (!row || (row as any).used_at || Date.parse((row as any).expires_at) < Date.now() || !UNDO_TABLES.has((row as any).table_name))
      return fail(t.undo_bad, 410);
    const op = String((row as any).op || "delete");
    // Phase 2: an UPDATE undo restores the row's previous values; a CAPTURE
    // undo removes the lines, the inbox row and the photo(s).
    if (op === "update") {
      const before = (row as any).before && typeof (row as any).before === "object" ? (row as any).before : null;
      if (!before) return fail(t.undo_bad, 410);
      const { data: back, error } = await sb.from((row as any).table_name).update(before).eq("id", (row as any).row_id).select("id");
      if (error) return fail(error.message, 500);
      if (!back || !back.length) return fail(t.nothing_deleted, 403);
      await sb.from("chef_undo").update({ used_at: new Date().toISOString() }).eq("token", token);
      const r: ChefActResult = { ok: true, card: card(t.undone, [], undefined, "write") };
      return Response.json(r);
    }
    if (op === "capture") {
      await sb.from("purchase_lines").delete().eq("invoice_inbox_id", (row as any).row_id);
      const { data: gone, error } = await sb.from("invoice_inbox").delete().eq("id", (row as any).row_id).select("id");
      if (error) return fail(error.message, 500);
      if (!gone || !gone.length) return fail(t.nothing_deleted, 403);
      const paths = String((row as any).storage_path || "").split(",").map((x) => x.trim()).filter(Boolean);
      if (paths.length) { try { await sb.storage.from("captures").remove(paths); } catch {} }
      await sb.from("chef_undo").update({ used_at: new Date().toISOString() }).eq("token", token);
      const r: ChefActResult = { ok: true, card: card(t.undone, [], undefined, "write") };
      return Response.json(r);
    }
    const { data: gone, error } = await sb.from((row as any).table_name).delete().eq("id", (row as any).row_id).select("id");
    if (error) return fail(error.message, 500);
    // Undoing a charter must also pull its queued _INBOX note, or the PA
    // would brief an agent for a job that no longer exists.
    if ((row as any).table_name === "agent_charters") {
      await sb.from("pa_inbox_notes").delete().eq("charter_id", (row as any).row_id).eq("status", "pending");
    }
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

  const undoFor = async (table: string, rowId: string, before?: Record<string, unknown>): Promise<string | null> => {
    const { data } = await sb.from("chef_undo").insert({
      user_id: uid, table_name: table, row_id: rowId,
      op: before ? "update" : "delete", before: before || null,
      expires_at: new Date(Date.now() + 24 * 3600_000).toISOString(),
    }).select("token").maybeSingle();
    return (data as any)?.token || null;
  };
  // Phase 2: an UPDATE write — read the columns we touch first so Undo can
  // put them back exactly.
  const patchRow = async (table: string, rowId: string, patch: Record<string, unknown>, extraFilter?: Record<string, string>) => {
    const cols = Object.keys(patch);
    let q = sb.from(table).select(["id", ...cols].join(", ")).eq("id", rowId);
    for (const [k, v] of Object.entries(extraFilter || {})) q = q.eq(k, v);
    const { data: prev } = await q.maybeSingle();
    if (!prev) return { ok: false as const, error: t.not_found, status: 404 };
    const before: Record<string, unknown> = {};
    for (const c of cols) before[c] = (prev as any)[c] ?? null;
    const { data: upd, error } = await sb.from(table).update(patch).eq("id", rowId).select("id");
    if (error) return { ok: false as const, error: error.message, status: 500 };
    if (!upd || !upd.length) return { ok: false as const, error: t.nothing_deleted, status: 403 };
    return { ok: true as const, before };
  };
  const doneUpdate = async (table: string, rowId: string, before: Record<string, unknown>, c: ChefCard) => {
    const undo_token = await undoFor(table, rowId, before);
    const r: ChefActResult = { ok: true, card: c, undo_token, navigate: null };
    return Response.json(r);
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
    // ---------------------------------------------------------------- Phase 2
    case "approve_reply": {
      // Outbound. The client only reaches here after the read-back + Yes
      // (tap, or a spoken yes inside the closed-grammar window). The gate
      // itself is inside meta-reply (approved_by_boris) — same as the page.
      const kind = action.kind === "dm" ? "dm" : "comment";
      const r = await approveAndSend(sb, kind, String(action.id || ""), String(action.text || ""), uid);
      if (!r.ok) return fail(r.error || t.send_failed, r.http === 200 ? 502 : r.http);
      const who = action.author || "";
      const res: ChefActResult = { ok: true, card: { ...card(t.sent(who), [clip(action.text, 140)], label, "write"), primary: { label: lang === "es" ? "Siguiente" : "Next", kind: "turn", message: "#inbox_next" } }, undo_token: null };
      return Response.json(res);
    }
    case "skip_comment": {
      const r = await patchRow("social_comments", String(action.id || ""), { status: "skipped" }, { entity_id: scope.entity.id });
      if (!r.ok) return fail(r.error, r.status);
      const c: ChefCard = { ...card(t.skipped(action.author || ""), [], label), primary: { label: lang === "es" ? "Siguiente" : "Next", kind: "turn", message: "#inbox_next" } };
      return doneUpdate("social_comments", String(action.id), r.before, c);
    }
    case "booking_update": {
      const patch: Record<string, unknown> = {};
      if (action.patch?.service_time) patch.service_time = String(action.patch.service_time);
      if (action.patch?.party_size) patch.party_size = Number(action.patch.party_size);
      if (action.patch?.service_date) patch.service_date = String(action.patch.service_date);
      if (action.patch?.notes != null) patch.notes = String(action.patch.notes);
      if (!Object.keys(patch).length) return fail("empty patch");
      const rid = ENTITY_TO_RESTAURANT[scope.entity.id as EntityKey];
      const r = await patchRow("bookings", String(action.id || ""), patch, rid ? { restaurant_id: rid } : undefined);
      if (!r.ok) return fail(r.error, r.status);
      return doneUpdate("bookings", String(action.id), r.before, card(t.booking, [clip(action.label || "", 140)], label));
    }
    case "prep_update": {
      const patch: Record<string, unknown> = {};
      if (action.patch?.status) { patch.status = String(action.patch.status); if (patch.status === "done") { patch.completed_at = new Date().toISOString(); patch.completed_by = uid; } else { patch.completed_at = null; patch.completed_by = null; } }
      if (action.patch?.quantity !== undefined) patch.quantity = action.patch.quantity;
      if (action.patch?.unit !== undefined) patch.unit = action.patch.unit;
      if (action.patch?.name) patch.name = clip(String(action.patch.name), 120);
      if (!Object.keys(patch).length) return fail("empty patch");
      const r = await patchRow("prep_lists", String(action.id || ""), patch, { entity_id: scope.entity.id });
      if (!r.ok) return fail(r.error, r.status);
      return doneUpdate("prep_lists", String(action.id), r.before, card(t.prep_upd, [clip(action.label || "", 140)], label));
    }
    default:
      return fail("unknown action type");
  }
}
