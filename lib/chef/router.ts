// Chef v3 Phase 1 — the intent router. Server only.
//
// Three steps per turn: (A) a deterministic regex pre-router for the obvious
// es/en phrasings so the common turns never pay for a model call, (B) a
// Haiku classifier that returns strict JSON, (C) execution — reads build a
// ChefCard here, writes are handed back as a ChefAction for the client to
// post to /api/chef/act (the confirm gate and undo live in ONE place).
//
// The model classifies; the code decides. Nothing in this file writes to a
// business table — only chef_turns for the log.

import { supabaseServer } from "@/lib/supabaseServer";
import { orchestrator, codeForEntityId, type AssistantEntityScope } from "@/lib/assistant/orchestrator";
import { loadEvents } from "@/lib/calendar.server";
import { E_HOLDINGS } from "@/lib/entities";
import { getFrestoAdapter } from "@/lib/integrations/fresto";
import {
  CONFIDENCE_ACT, CONFIDENCE_READ_ONLY, isWriteIntent,
  type ChefAction, type ChefCard, type ChefIntent, type ChefLang, type ChefTurn,
} from "@/lib/chef/types";

export type ChefTurnInput = {
  message: string;
  route: string;
  sessionId: string | null;
  entityId: string;
  language: ChefLang;
  pageContext: any;
  uid: string | null;
  voice: boolean;
  scope: AssistantEntityScope;
  houseSlug: string | null;
};

const CLASSIFIER_MODEL = "claude-haiku-4-5-20251001";
// Haiku 4.5 list price, USD/MTok → cents. Kept local so cost_cents is auditable.
const PRICE_IN_CENTS_PER_MTOK = 80;
const PRICE_OUT_CENTS_PER_MTOK = 400;

type Outcome = "card" | "navigate" | "pending_confirm" | "pending_undo" | "clarify" | "error";

// Raw classifier output — the shape the model is asked for.
type Classified = {
  intent: string;
  confidence: number;
  language?: string;
  args?: Record<string, any>;
};

// ---------------------------------------------------------------- strings
const T = {
  es: {
    which_house: "¿Para qué casa? Elige una en el selector.",
    which_house_say: "¿Para qué casa?",
    not_sure: "No te he entendido. ¿Qué quieres hacer?",
    not_sure_say: "¿Puedes repetirlo?",
    not_phase1: "Aprobar y editar desde Chef llegan en la fase 2. Ábrelo desde la página.",
    not_phase1_say: "Eso aún no, ábrelo desde la página.",
    open: "Abrir",
    remember: "Apuntado",
    feedback: "Feedback guardado",
    prep: "Añadido a la mise",
    todo: "Tarea creada",
    agent: "Lanzar agente",
    agent_readback: (t: string, o: string) => "Lanzo un agente de " + t + ": " + o + ". Sale de la cuenta. ¿Confirmas?",
    no_recipe: "No encuentro esa receta",
    recipes_found: (n: number) => n + " recetas",
    bookings: (n: number, c: number) => n + " reservas, " + c + " cubiertos",
    no_bookings: "Sin reservas",
    first_last: (a: string, b: string) => "Primera " + a + ", última " + b,
    notes: (n: number) => n + " con notas",
    prep_summary: (d: number, n: number) => d + " de " + n + " hechas",
    no_prep: "Mise vacía hoy",
    no_events: "Nada en el calendario hoy",
    events: (n: number) => n + " eventos hoy",
    waiting: (n: number) => n + " comentarios esperando",
    none_waiting: "Bandeja al día",
    ask_failed: "Chef no ha podido responder",
    remember_say: "Apuntado",
    feedback_say: "Feedback guardado",
    prep_say: (q: string) => "Añado " + q + " a la mise",
    todo_say: "Creo la tarea",
    navigate_say: "Abriendo",
    capture_say: "Abro la cámara",
    or_ask: "Preguntar a Chef",
  },
  en: {
    which_house: "Which house? Pick one in the switcher.",
    which_house_say: "Which house?",
    not_sure: "I didn't catch that. What do you want to do?",
    not_sure_say: "Can you say that again?",
    not_phase1: "Approve and edit from Chef arrive in phase 2. Open it from the page.",
    not_phase1_say: "Not yet, open it from the page.",
    open: "Open",
    remember: "Noted",
    feedback: "Feedback saved",
    prep: "Added to prep",
    todo: "Task created",
    agent: "Run agent",
    agent_readback: (t: string, o: string) => "Run a " + t + " agent: " + o + ". This leaves the account. Confirm?",
    no_recipe: "No recipe found",
    recipes_found: (n: number) => n + " recipes",
    bookings: (n: number, c: number) => n + " bookings, " + c + " covers",
    no_bookings: "No bookings",
    first_last: (a: string, b: string) => "First " + a + ", last " + b,
    notes: (n: number) => n + " with notes",
    prep_summary: (d: number, n: number) => d + " of " + n + " done",
    no_prep: "Prep list empty today",
    no_events: "Nothing on the calendar today",
    events: (n: number) => n + " events today",
    waiting: (n: number) => n + " comments waiting",
    none_waiting: "Inbox clear",
    ask_failed: "Chef could not answer",
    remember_say: "Noted",
    feedback_say: "Feedback saved",
    prep_say: (q: string) => "Adding " + q + " to prep",
    todo_say: "Creating the task",
    navigate_say: "Opening",
    capture_say: "Opening the camera",
    or_ask: "Ask Chef",
  },
} as const;

// ---------------------------------------------------------------- helpers
function tzDate(tz: string, offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
function hhmm(iso: string, tz: string) {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: tz || "Europe/Madrid", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(iso));
  return (p.find((x) => x.type === "hour")?.value || "00") + ":" + (p.find((x) => x.type === "minute")?.value || "00");
}
// "13:00:00" → "13:00"
function clockShort(t: string | null | undefined) { return String(t || "").slice(0, 5); }
function clip(s: string, n: number) { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; }
function firstSentence(s: string, maxWords = 12) {
  const first = String(s || "").split(/(?<=[.!?])\s+|\n/)[0] || "";
  return first.split(/\s+/).slice(0, maxWords).join(" ");
}
function toLines(s: string, max = 4, width = 140): string[] {
  const parts = String(s || "").split(/\n+|(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
  const out: string[] = [];
  for (const p of parts) { if (out.length >= max) break; out.push(clip(p, width)); }
  return out.length ? out : [clip(s, width)];
}

// The card body navigates here. Rooms live under a house; without a house we
// fall back to the entity-agnostic surface rather than guessing a slug.
function pageHref(word: string, house: string | null): string | null {
  const h = house ? "/h/" + house : null;
  const w = word.toLowerCase();
  if (/receta|recipe/.test(w)) return h ? h + "/kitchen/recipes" : "/develop/recipes";
  if (/reserva|booking/.test(w)) return "/execute/bookings";
  if (/calendar|agenda/.test(w)) return h ? h + "/calendar" : "/me/calendar";
  if (/inbox|comentario|mensaje|bandeja/.test(w)) return h ? h + "/office/inbox" : "/office";
  if (/prep|mise/.test(w)) return h ? h + "/kitchen/prep" : "/boh";
  if (/caja|eod|cierre/.test(w)) return "/administrate/finance/eod";
  if (/equipo|team/.test(w)) return "/administrate/team";
  if (/oficina|office/.test(w)) return h ? h + "/office" : "/office";
  if (/cocina|kitchen/.test(w)) return h ? h + "/kitchen" : "/boh";
  if (/sala|dining|comedor/.test(w)) return h ? h + "/dining" : "/";
  if (/inicio|home|start/.test(w)) return "/";
  return null;
}

function clarifyTurn(transcript: string, language: ChefLang, question: string, say: string, entityLabel?: string): ChefTurn {
  return {
    transcript, language,
    intent: { kind: "clarify", question },
    confidence: 0, say,
    card: { title: say, lines: [question], kind: "read", entity_label: entityLabel },
    needs_confirm: false,
  };
}

// ---------------------------------------------------------------- step A
// Deterministic pre-router. Only fires on unambiguous phrasings; anything
// else falls through to the model.
function preRoute(message: string, language: ChefLang): Classified | null {
  const m = message.trim().toLowerCase();
  if (!m || m.length > 160) return null;
  const nav = m.match(/^(?:abre|abrir|ir a|ve a|vamos a|open|go to|show me|enséñame|muéstrame)\s+(?:la |el |los |las |the |my |mi )?([a-záéíóúñ ]{3,30})$/);
  if (nav) {
    const word = nav[1].trim();
    if (pageHref(word, "x")) return { intent: "navigate", confidence: 0.98, language, args: { to: word } };
  }
  if (/^(?:albar[aá]n|factura|foto|captura|capture|scan|escanea|escanear)(?:\s|$)/.test(m) || /^(?:haz|hacer|toma|take)\s+(?:una\s+)?(?:foto|captura|photo)/.test(m))
    return { intent: "capture", confidence: 0.97, language, args: { type: "auto" } };
  const rem = m.match(/^(?:ap[uú]ntate|apunta|recuerda|acu[eé]rdate|remember)\s+(?:que\s+|that\s+)?(.{3,})$/);
  if (rem) return { intent: "remember", confidence: 0.96, language, args: { text: message.trim().replace(/^[^\s]+\s+(?:que\s+|that\s+)?/i, "") } };
  if (/^(?:feedback|esto est[aá] mal|this is broken|bug)\b/.test(m)) {
    const kind = /bug|broken|mal/.test(m) ? "bug" : "idea";
    return { intent: "feedback", confidence: 0.95, language, args: { text: message.trim(), feedback_kind: kind } };
  }
  return null;
}

// ---------------------------------------------------------------- step B
const CLASSIFIER_SYSTEM = `You classify ONE short utterance from a restaurant operator into an intent. Reply with a single JSON object and nothing else.

Schema: {"intent": string, "confidence": number 0-1, "language": "es"|"en", "args": object}

Intents (exact strings) and their args:
- "query recipes"   {q: dish name}                         — a recipe / how to make something
- "query bookings"  {date: "today"|"tomorrow"|"YYYY-MM-DD"} — bookings, covers, reservations
- "query prep"      {}                                       — today's prep list / mise en place
- "query calendar"  {}                                       — what's on today
- "query inbox"     {}                                       — waiting comments / messages
- "navigate"        {to: page word}                          — open/go to a page (recipes, bookings, calendar, inbox, prep, eod/caja, team, office, kitchen, dining, home)
- "capture"         {type: "auto"|"delivery_note"|"invoice"|"wine"} — photograph a delivery note / invoice / bottle
- "create prep"     {name, quantity?, unit?, station?}       — add an item to the prep list
- "create team"     {title}                                  — a task / to-do for someone (not a prep item)
- "remember"        {text}                                   — store a fact
- "feedback"        {text, feedback_kind: "love"|"idea"|"bug"|"confusing"} — something is wrong / an idea about the OS
- "run_agent"       {agent_type: "research"|"build"|"write"|"pa", objective} — delegate work to an agent
- "query ask"       {q}                                      — any other question about the venue or the OS
- "clarify"         {question}                               — cannot tell

Examples:
"receta del romesco" → {"intent":"query recipes","confidence":0.95,"language":"es","args":{"q":"romesco"}}
"how do we make the sourdough" → {"intent":"query recipes","confidence":0.9,"language":"en","args":{"q":"sourdough"}}
"reservas de hoy" → {"intent":"query bookings","confidence":0.96,"language":"es","args":{"date":"today"}}
"cuántos cubiertos mañana" → {"intent":"query bookings","confidence":0.94,"language":"es","args":{"date":"tomorrow"}}
"qué hay en el calendario" → {"intent":"query calendar","confidence":0.93,"language":"es","args":{}}
"cuántos comentarios esperan" → {"intent":"query inbox","confidence":0.92,"language":"es","args":{}}
"what's left on prep" → {"intent":"query prep","confidence":0.9,"language":"en","args":{}}
"abre la caja" → {"intent":"navigate","confidence":0.95,"language":"es","args":{"to":"caja"}}
"albarán" → {"intent":"capture","confidence":0.9,"language":"es","args":{"type":"delivery_note"}}
"añade 2 kg de cebolla a la mise" → {"intent":"create prep","confidence":0.93,"language":"es","args":{"name":"cebolla","quantity":2,"unit":"kg"}}
"que Marta llame al proveedor de pescado" → {"intent":"create team","confidence":0.85,"language":"es","args":{"title":"Marta: llamar al proveedor de pescado"}}
"apúntate que a Noelia no le gusta el cilantro" → {"intent":"remember","confidence":0.95,"language":"es","args":{"text":"A Noelia no le gusta el cilantro"}}
"esto está mal, el precio no cuadra" → {"intent":"feedback","confidence":0.9,"language":"es","args":{"text":"El precio no cuadra","feedback_kind":"bug"}}
"que alguien investigue proveedores de ostras en Galicia" → {"intent":"run_agent","confidence":0.9,"language":"es","args":{"agent_type":"research","objective":"Investigar proveedores de ostras en Galicia"}}
"why is the margin on the sea bass low" → {"intent":"query ask","confidence":0.8,"language":"en","args":{"q":"why is the margin on the sea bass low"}}
"eso" → {"intent":"clarify","confidence":0.2,"language":"es","args":{"question":"¿Qué quieres hacer?"}}

Rules: never invent a dish or a number. If a request edits or approves something, use "clarify". Confidence below 0.6 means you are guessing.`;

async function classify(message: string, language: ChefLang, route: string): Promise<{ c: Classified; cost_cents: number }> {
  const key = process.env.ANTHROPIC_API_KEY;
  const fallback: Classified = { intent: "query ask", confidence: 0.7, language, args: { q: message } };
  if (!key) return { c: fallback, cost_cents: 0 };
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: CLASSIFIER_MODEL, max_tokens: 400, temperature: 0, system: CLASSIFIER_SYSTEM,
        messages: [{ role: "user", content: "[screen: " + (route || "/") + "] [lang: " + language + "]\n" + message }],
      }),
    });
    const data: any = await r.json();
    const text: string = data?.content?.[0]?.text || "";
    const inTok = Number(data?.usage?.input_tokens || 0);
    const outTok = Number(data?.usage?.output_tokens || 0);
    const cost_cents = (inTok / 1_000_000) * PRICE_IN_CENTS_PER_MTOK + (outTok / 1_000_000) * PRICE_OUT_CENTS_PER_MTOK;
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return { c: fallback, cost_cents };
    const j = JSON.parse(m[0]);
    const c: Classified = {
      intent: String(j.intent || "clarify"),
      confidence: Math.max(0, Math.min(1, Number(j.confidence) || 0)),
      language: j.language === "es" || j.language === "en" ? j.language : language,
      args: j.args && typeof j.args === "object" ? j.args : {},
    };
    return { c, cost_cents };
  } catch {
    return { c: fallback, cost_cents: 0 };
  }
}

// ---------------------------------------------------------------- step C: reads
type ReadCtx = { scope: AssistantEntityScope; house: string | null; lang: ChefLang; uid: string | null; message: string };

async function readRecipes(q: string, ctx: ReadCtx): Promise<{ card: ChefCard; say: string }> {
  const sb = supabaseServer();
  const t = T[ctx.lang];
  const label = ctx.scope.entity.name;
  const needle = "%" + q.trim().replace(/\s+/g, "%") + "%";
  const cols = "id, name, yield_qty, yield_unit, portions, method, entity_id";
  let { data: rows } = await sb.from("recipes").select(cols).eq("entity_id", ctx.scope.entity.id)
    .eq("is_active", true).eq("is_archived", false).ilike("name", needle).limit(5);
  // Fall back to the shared library (canonical copies readable via the
  // mirror policy) when the house has no copy of its own.
  if (!rows || !rows.length) {
    const r = await sb.from("recipes").select(cols).is("origin_recipe_id", null).eq("is_active", true)
      .eq("is_archived", false).ilike("name", needle).limit(5);
    rows = r.data || [];
  }
  const listHref = pageHref("recipes", ctx.house) || "/develop/recipes";
  if (!rows.length) {
    return { say: t.no_recipe + ": " + clip(q, 30), card: { title: t.no_recipe, lines: [clip(q, 80)], kind: "read", entity_label: label, href: listHref } };
  }
  // "romesco" should land on Romesco, not on "Cauliflower Steak, Romesco and
  // Almonds": exact name first, then the shortest name containing the words.
  const ql = q.trim().toLowerCase();
  const ranked = [...rows].sort((a: any, b: any) => {
    const an = String(a.name || "").toLowerCase(), bn = String(b.name || "").toLowerCase();
    const ae = an === ql ? 0 : an.startsWith(ql) ? 1 : 2, be = bn === ql ? 0 : bn.startsWith(ql) ? 1 : 2;
    return ae - be || an.length - bn.length;
  });
  const r: any = ranked[0];
  const href = ctx.house ? "/h/" + ctx.house + "/kitchen/recipes/" + r.id : "/develop/menu/" + r.id;
  const { data: steps } = await sb.from("recipe_steps").select("order_idx, body").eq("recipe_id", r.id).order("order_idx").limit(3);
  const stepLines = (steps || []).map((s: any) => clip(s.body, 80));
  const methodLines = stepLines.length ? stepLines : String(r.method || "").split(/\n+/).map((x) => x.trim()).filter(Boolean).slice(0, 3).map((x) => clip(x, 80));
  const yieldStr = r.yield_qty ? r.yield_qty + " " + (r.yield_unit || "") : r.portions ? r.portions + (ctx.lang === "es" ? " raciones" : " portions") : "";
  const lines = [yieldStr, ...methodLines].filter(Boolean).slice(0, 4);
  const say = ranked.length > 1 ? t.recipes_found(ranked.length) + ", " + r.name : r.name + (yieldStr ? ", " + yieldStr : "");
  return { say: clip(say, 80), card: { title: clip(r.name, 60), lines, kind: "read", entity_label: label, href, primary: { label: t.open, kind: "navigate", href } } };
}

async function readBookings(dateArg: string, ctx: ReadCtx): Promise<{ card: ChefCard; say: string }> {
  const sb = supabaseServer();
  const t = T[ctx.lang];
  const tz = ctx.scope.entity.timezone;
  const date = dateArg === "tomorrow" ? tzDate(tz, 1) : /^\d{4}-\d{2}-\d{2}$/.test(dateArg) ? dateArg : tzDate(tz);
  const rid = ctx.scope.restaurant_id;
  const href = "/execute/bookings";
  let rows: any[] = rid ? ((await sb.from("bookings").select("party_size, service_time, status, notes").eq("restaurant_id", rid).eq("service_date", date)).data || []) : [];
  let frestoOffline = false;
  // No rows in the DB → the venue's book lives in Fresto. Same read-only
  // seam the floor plan uses, but ONLY when the adapter is live: a spoken
  // "23 covers" from the mock would be an invented number (brief §7).
  if (!rows.length && rid) {
    try {
      const fresto = await getFrestoAdapter(rid);
      if (fresto.mode === "live") {
        const fb = await fresto.getBookings(date);
        rows = fb.map((b) => ({ party_size: b.partySize, service_time: b.time, status: b.status, notes: null }));
      } else frestoOffline = true;
    } catch { frestoOffline = true; }
  }
  const live = rows.filter((b: any) => !["cancelled", "no_show"].includes(String(b.status || "").toLowerCase()));
  const covers = live.reduce((a: number, b: any) => a + Number(b.party_size || 0), 0);
  const times = live.map((b: any) => clockShort(b.service_time)).filter(Boolean).sort();
  const notes = live.filter((b: any) => String(b.notes || "").trim()).length;
  if (!live.length) return { say: t.no_bookings + " " + date, card: { title: t.no_bookings, lines: [date + (frestoOffline ? (ctx.lang === "es" ? " · Fresto sin conectar" : " · Fresto not connected") : "")], kind: "read", entity_label: ctx.scope.entity.name, href, primary: { label: t.open, kind: "navigate", href } } };
  const lines = [date, t.bookings(live.length, covers)];
  if (times.length) lines.push(t.first_last(times[0], times[times.length - 1]));
  if (notes) lines.push(t.notes(notes));
  const say = ctx.lang === "es"
    ? covers + " cubiertos" + (times.length ? ", primera a las " + times[0] : "")
    : covers + " covers" + (times.length ? ", first at " + times[0] : "");
  return { say, card: { title: t.bookings(live.length, covers), lines, kind: "read", entity_label: ctx.scope.entity.name, href, primary: { label: t.open, kind: "navigate", href } } };
}

async function readPrep(ctx: ReadCtx): Promise<{ card: ChefCard; say: string }> {
  const sb = supabaseServer();
  const t = T[ctx.lang];
  const date = tzDate(ctx.scope.entity.timezone);
  const href = pageHref("prep", ctx.house) || "/boh";
  const { data } = await sb.from("prep_lists").select("name, quantity, unit, status, station").eq("entity_id", ctx.scope.entity.id).eq("service_date", date).order("created_at");
  const items = data || [];
  const done = items.filter((i: any) => i.status === "done").length;
  const open = items.filter((i: any) => i.status !== "done").slice(0, 3);
  if (!items.length) return { say: t.no_prep, card: { title: t.no_prep, lines: [date], kind: "read", entity_label: ctx.scope.entity.name, href, primary: { label: t.open, kind: "navigate", href } } };
  const lines = [t.prep_summary(done, items.length), ...open.map((i: any) => clip([i.quantity, i.unit, i.name].filter(Boolean).join(" "), 80))];
  return { say: t.prep_summary(done, items.length), card: { title: t.prep_summary(done, items.length), lines: lines.slice(0, 4), kind: "read", entity_label: ctx.scope.entity.name, href, primary: { label: t.open, kind: "navigate", href } } };
}

async function readCalendar(ctx: ReadCtx): Promise<{ card: ChefCard; say: string }> {
  const t = T[ctx.lang];
  const tz = ctx.scope.entity.timezone;
  const href = pageHref("calendar", ctx.house) || "/me/calendar";
  // Local midnight → next midnight, expressed as UTC instants. Cheap trick:
  // format today's date in the venue tz, then let Date parse it with the
  // venue's current UTC offset.
  const today = tzDate(tz);
  const offsetMin = tzOffsetMinutes(tz);
  const from = new Date(Date.parse(today + "T00:00:00Z") - offsetMin * 60_000).toISOString();
  const to = new Date(Date.parse(today + "T00:00:00Z") - offsetMin * 60_000 + 86400_000).toISOString();
  let events: any[] = [];
  try { events = await loadEvents({ from, to, entityId: ctx.scope.entity.id }); } catch { events = []; }
  if (!events.length) return { say: t.no_events, card: { title: t.no_events, lines: [today], kind: "read", entity_label: ctx.scope.entity.name, href, primary: { label: t.open, kind: "navigate", href } } };
  const lines = events.slice(0, 3).map((e) => clip((e.all_day ? (ctx.lang === "es" ? "Todo el día" : "All day") : hhmm(e.start_ts, tz)) + " " + e.title, 100));
  const first = events[0];
  const say = t.events(events.length) + (first.all_day ? "" : ", " + hhmm(first.start_ts, tz) + " " + clip(first.title, 30));
  return { say: clip(say, 90), card: { title: t.events(events.length), lines, kind: "read", entity_label: ctx.scope.entity.name, href, primary: { label: t.open, kind: "navigate", href } } };
}
function tzOffsetMinutes(tz: string): number {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz || "Europe/Madrid", hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(now);
  const g = (k: string) => Number(parts.find((p) => p.type === k)?.value || 0);
  const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"), g("second"));
  return Math.round((asUtc - now.getTime()) / 60_000);
}

async function readInbox(ctx: ReadCtx): Promise<{ card: ChefCard; say: string }> {
  const sb = supabaseServer();
  const t = T[ctx.lang];
  const href = pageHref("inbox", ctx.house) || "/office";
  const [{ data: w }, { data: top }] = await Promise.all([
    sb.from("social_inbox_waiting").select("waiting").eq("entity_id", ctx.scope.entity.id).maybeSingle(),
    sb.from("social_comments").select("author_handle, author_name, text, platform").eq("entity_id", ctx.scope.entity.id)
      .in("status", ["new", "drafted"]).order("created_at_remote", { ascending: false, nullsFirst: false }).limit(1).maybeSingle(),
  ]);
  const waiting = Number((w as any)?.waiting || 0);
  if (!waiting) return { say: t.none_waiting, card: { title: t.none_waiting, lines: [], kind: "read", entity_label: ctx.scope.entity.name, href, primary: { label: t.open, kind: "navigate", href } } };
  const lines = [t.waiting(waiting)];
  if (top) lines.push(clip(((top as any).author_handle || (top as any).author_name || (top as any).platform || "") + ": " + ((top as any).text || ""), 100));
  return { say: t.waiting(waiting), card: { title: t.waiting(waiting), lines, kind: "read", entity_label: ctx.scope.entity.name, href, primary: { label: t.open, kind: "navigate", href } } };
}

// Free-form question → the existing orchestrator chat path, unchanged, so
// the reputation draft and any other legacy caller get the same reply text.
async function readAsk(input: ChefTurnInput): Promise<{ card: ChefCard; say: string; reply: string; cost_cents: number; ok: boolean }> {
  const t = T[input.language];
  const { scope, uid, pageContext, route, sessionId, message, language } = input;
  const [context, memory, config, history] = await Promise.all([
    orchestrator.getContext(scope, uid, pageContext, route),
    orchestrator.getMemory(scope, uid),
    orchestrator.getConfig(scope),
    orchestrator.getHistory(sessionId, uid),
  ]);
  const prompt = (route ? "[screen: " + route + "]\n" : "") + "[lang: " + language + "]\n" + message;
  const result = await orchestrator.generate({ context, memory, config, history, prompt, mode: "chat", language });
  if (uid && result.ok) {
    const entity = codeForEntityId(scope.entity.id) || scope.entity.id;
    try { await orchestrator.logInteraction({ userId: uid, entity, route, sessionId, userPrompt: message, result, mode: "chat" }); } catch {}
  }
  // The orchestrator prepends a "[Chef flag: …]" grounding warning when the
  // reply names something not in context. It must not become the card title.
  const reply = result.ok ? result.text.replace(/\[Chef flag:[\s\S]*?\]\s*/g, "").trim() : t.ask_failed;
  const lines = toLines(reply);
  return {
    ok: result.ok, reply,
    say: clip(firstSentence(reply), 90),
    card: { title: clip(firstSentence(reply, 8) || t.ask_failed, 60), lines, kind: result.ok ? "read" : "error", entity_label: scope.entity.name },
    cost_cents: (result.cost_usd || 0) * 100,
  };
}

// ---------------------------------------------------------------- log
async function logTurn(input: ChefTurnInput, turn: ChefTurn, outcome: Outcome, t0: number, cost_cents: number): Promise<string | null> {
  try {
    const sb = supabaseServer();
    const { data } = await sb.from("chef_turns").insert({
      user_id: input.uid,
      entity_id: input.scope.entity.id,
      route: input.route || null,
      transcript: input.message.slice(0, 4000),
      intent: turn.intent,
      confidence: turn.confidence,
      outcome,
      latency_ms: Date.now() - t0,
      cost_cents,
      voice: !!input.voice,
      language: input.language,
      session_id: input.sessionId,
    }).select("id").maybeSingle();
    return (data as any)?.id || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- main
export async function runChefTurn(input: ChefTurnInput): Promise<ChefTurn> {
  const t0 = Date.now();
  const { message, scope, houseSlug, language } = input;
  const t = T[language];
  const entityId = input.entityId; // "" when the caller sent no entity (legacy read-only callers) — writes refuse below
  const label = scope?.entity?.name;
  const chefScope = { entity_id: entityId, house: houseSlug || undefined };

  // The reputation page sends a long draft prompt tagged in page_context —
  // it must reach the chat model verbatim, never the classifier.
  const forcedAsk = input.pageContext && input.pageContext.intent === "draft_reply";

  let cost = 0;
  let c: Classified | null = forcedAsk ? { intent: "query ask", confidence: 1, language, args: { q: message } } : preRoute(message, language);
  if (!c) {
    const r = await classify(message, language, input.route);
    c = r.c; cost += r.cost_cents;
  }
  const conf = c.confidence;
  const args = c.args || {};
  const lang: ChefLang = c.language === "es" || c.language === "en" ? c.language : language;
  const tl = T[lang];
  const rctx: ReadCtx = { scope, house: houseSlug, lang, uid: input.uid, message };

  const finish = async (turn: ChefTurn, outcome: Outcome) => {
    turn.turn_id = await logTurn(input, turn, outcome, t0, cost);
    turn.latency_ms = Date.now() - t0;
    return turn;
  };
  const clarify = (question: string, say: string) => finish(clarifyTurn(message, lang, question, say, label), "clarify");

  // Low confidence: one question, no guessing.
  if (c.intent !== "clarify" && conf < CONFIDENCE_READ_ONLY) return clarify(tl.not_sure, tl.not_sure_say);

  const isWrite = ["create prep", "create team", "remember", "feedback", "run_agent"].includes(c.intent);
  // Writes need a real house. Holdings is not a kitchen; never default to BM.
  if (isWrite && (!entityId || entityId === E_HOLDINGS)) return clarify(tl.which_house, tl.which_house_say);

  // Mid-band writes stay pending with ONE alternative chip; reads just run.
  const midBand = conf < CONFIDENCE_ACT;
  const alt: ChefIntent[] | undefined = isWrite && midBand
    ? [{ kind: "query", surface: "ask", q: message, scope: chefScope }]
    : undefined;

  try {
    switch (c.intent) {
      case "navigate": {
        const word = String(args.to || "");
        const href = pageHref(word, houseSlug);
        if (!href) return clarify(tl.not_sure, tl.not_sure_say);
        const intent: ChefIntent = { kind: "navigate", to: href };
        return finish({
          transcript: message, language: lang, intent, confidence: conf,
          say: tl.navigate_say + " " + clip(word, 30), needs_confirm: false, navigate: href,
        }, "navigate");
      }
      case "capture": {
        const type = (["delivery_note", "invoice", "wine", "auto"] as const).includes(args.type) ? args.type : "auto";
        const href = "/capture?type=" + type + "&entity=" + encodeURIComponent(entityId);
        return finish({
          transcript: message, language: lang, intent: { kind: "capture", type }, confidence: conf,
          say: tl.capture_say, needs_confirm: false, navigate: href,
        }, "navigate");
      }
      case "query recipes": {
        const q = String(args.q || message);
        const r = await readRecipes(q, rctx);
        return finish({ transcript: message, language: lang, intent: { kind: "query", surface: "recipes", q, scope: chefScope }, confidence: conf, say: r.say, card: r.card, needs_confirm: false }, "card");
      }
      case "query bookings": {
        const date = String(args.date || "today");
        const r = await readBookings(date, rctx);
        return finish({ transcript: message, language: lang, intent: { kind: "query", surface: "bookings", q: date, scope: chefScope }, confidence: conf, say: r.say, card: r.card, needs_confirm: false }, "card");
      }
      case "query prep": {
        const r = await readPrep(rctx);
        return finish({ transcript: message, language: lang, intent: { kind: "query", surface: "prep", q: "today", scope: chefScope }, confidence: conf, say: r.say, card: r.card, needs_confirm: false }, "card");
      }
      case "query calendar": {
        const r = await readCalendar(rctx);
        return finish({ transcript: message, language: lang, intent: { kind: "query", surface: "calendar", q: "today", scope: chefScope }, confidence: conf, say: r.say, card: r.card, needs_confirm: false }, "card");
      }
      case "query inbox": {
        const r = await readInbox(rctx);
        return finish({ transcript: message, language: lang, intent: { kind: "query", surface: "inbox", q: "waiting", scope: chefScope }, confidence: conf, say: r.say, card: r.card, needs_confirm: false }, "card");
      }
      case "query ask": {
        const r = await readAsk({ ...input, language: lang });
        cost += r.cost_cents;
        return finish({ transcript: message, language: lang, intent: { kind: "query", surface: "ask", q: message, scope: chefScope }, confidence: conf, say: r.say, card: r.card, needs_confirm: false, reply: r.reply }, r.ok ? "card" : "error");
      }
      case "remember": {
        const text = clip(String(args.text || message), 600);
        const action: ChefAction = { type: "remember", text, entity_id: entityId };
        return finish({
          transcript: message, language: lang, intent: { kind: "remember", text }, confidence: conf,
          say: tl.remember_say + ": " + clip(text, 60), needs_confirm: false, undoable: true, action, alternatives: alt,
          card: { title: tl.remember, lines: [clip(text, 140)], kind: "write", entity_label: label },
        }, "pending_undo");
      }
      case "feedback": {
        const text = clip(String(args.text || message), 2000);
        const kinds = ["love", "idea", "bug", "confusing"] as const;
        const feedback_kind = (kinds as readonly string[]).includes(args.feedback_kind) ? args.feedback_kind as typeof kinds[number] : "idea";
        const action: ChefAction = { type: "feedback", text, page: input.route, feedback_kind, entity_id: entityId };
        return finish({
          transcript: message, language: lang, intent: { kind: "feedback", text, page: input.route, feedback_kind }, confidence: conf,
          say: tl.feedback_say, needs_confirm: false, undoable: true, action, alternatives: alt,
          card: { title: tl.feedback, lines: [clip(text, 140)], kind: "write", entity_label: label },
        }, "pending_undo");
      }
      case "create prep": {
        const name = clip(String(args.name || ""), 120);
        if (!name) return clarify(tl.not_sure, tl.not_sure_say);
        const quantity = args.quantity != null && !isNaN(Number(args.quantity)) ? Number(args.quantity) : null;
        const unit = args.unit ? clip(String(args.unit), 20) : null;
        const station = args.station ? clip(String(args.station), 40) : null;
        const action: ChefAction = { type: "prep_add", entity_id: entityId, name, quantity, unit, station };
        const qStr = [quantity, unit, name].filter((x) => x != null && x !== "").join(" ");
        return finish({
          transcript: message, language: lang,
          intent: { kind: "create", surface: "prep", draft: { name, quantity, unit, station }, scope: chefScope }, confidence: conf,
          say: tl.prep_say(qStr), needs_confirm: false, undoable: true, action, alternatives: alt,
          card: { title: tl.prep, lines: [qStr], kind: "write", entity_label: label },
        }, "pending_undo");
      }
      case "create team": {
        const title = clip(String(args.title || message), 500);
        const action: ChefAction = { type: "todo_add", entity_id: entityId, title };
        return finish({
          transcript: message, language: lang,
          intent: { kind: "create", surface: "team", draft: { title }, scope: chefScope }, confidence: conf,
          say: tl.todo_say + ": " + clip(title, 50), needs_confirm: false, undoable: true, action, alternatives: alt,
          card: { title: tl.todo, lines: [clip(title, 140)], kind: "write", entity_label: label },
        }, "pending_undo");
      }
      case "run_agent": {
        const types = ["research", "build", "write", "pa"] as const;
        const agent_type = (types as readonly string[]).includes(args.agent_type) ? args.agent_type as typeof types[number] : "research";
        const objective = clip(String(args.objective || message), 1000);
        const action: ChefAction = { type: "run_agent", entity_id: entityId, agent_type, objective, route: input.route };
        const readback = tl.agent_readback(agent_type, objective);
        return finish({
          transcript: message, language: lang,
          intent: { kind: "run_agent", agent_type, objective }, confidence: conf,
          say: tl.agent + ": " + clip(objective, 50), needs_confirm: true, readback, action, alternatives: alt,
          card: { title: tl.agent, lines: [clip(objective, 140), label || ""].filter(Boolean), kind: "confirm", entity_label: label, primary: { label: lang === "es" ? "Sí, lanzar" : "Yes, run it", kind: "act", action }, chip: alt ? { label: tl.or_ask, kind: "none" } : undefined },
        }, "pending_confirm");
      }
      case "clarify": {
        const q = String(args.question || tl.not_sure);
        // Approve / update phrasings land here in Phase 1 — say so.
        const notYet = /aprob|aprueb|approve|edita|cambia|update|modif|change/i.test(message);
        return clarify(notYet ? tl.not_phase1 : q, notYet ? tl.not_phase1_say : clip(q, 60));
      }
      default:
        return clarify(tl.not_sure, tl.not_sure_say);
    }
  } catch (e: any) {
    const msg = String(e?.message || e);
    return finish({
      transcript: message, language: lang, intent: { kind: "clarify", question: tl.not_sure }, confidence: 0,
      say: tl.ask_failed, needs_confirm: false,
      card: { title: tl.ask_failed, lines: [clip(msg, 140)], kind: "error", entity_label: label },
    }, "error");
  }
}
