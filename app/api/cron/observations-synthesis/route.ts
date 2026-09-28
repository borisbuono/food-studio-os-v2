import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { supabaseService } from "@/lib/supabaseService";
import { cronAuthorized, startRun, finishRun } from "@/lib/cron/heartbeat";
import type { ObservationRow } from "@/lib/observations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Weekly synthesis of the observation log (Foundation §3 "The mechanism").
//
// Reads EVERY row with synthesised_at is null — all entities, all domains, one
// query — and asks Claude one question: "What pattern has formed that nobody
// has named yet?", looking hardest across domains. Candidates go to
// observation_patterns (status 'proposed'); every row read is stamped
// synthesised_at. It NEVER writes master_todos — a human accepts a pattern
// (observation_pattern_accept) and only then is promoted_to set and a register
// row created. It never writes back into the log.
//
// Trigger: pg_cron 'observations-synthesis', Monday 05:30 UTC (Vercel Hobby
// cron slots are full) → net.http_post with x-scheduler-secret from Vault.
// Auth here is either that header (checked by observations_synthesis_secret_ok,
// a definer RPC, so no service key is needed) or the usual Bearer CRON_SECRET
// (which then needs SUPABASE_SERVICE_ROLE_KEY to read across tenants).
//
// Sonnet, not Haiku: this is the one place judgement matters.
const MODEL = process.env.OBSERVATIONS_SYNTHESIS_MODEL || "claude-sonnet-4-5";
const MAX_ROWS = 4000;

type Pattern = { entity_code: string; pattern: string; evidence_ids: string[]; proposed_target: "register" | "counterparty_note" | "decision" };

const SYSTEM = `You read the observation log of a small restaurant group whole, once a week. Each line is something an agent or the owner found slightly odd and wrote down without judging it. Nothing acts on a single line.

You answer ONE question: what pattern has formed that nobody has named yet?

Look hardest ACROSS domains and across entities (a purchasing line plus a comms line plus a finance line may be one pattern). A pattern is two or more lines that together say something no single line says, or one line that on its own is plainly a control question the owner has not asked. Do not restate a line. Do not summarise the log. Do not propose anything about an employee, a candidate or a person's character — counterparties (suppliers, landlords, platforms, tools) are fine.

For each pattern say where it should go if the owner agrees:
- "register": a constraint or an identifier the business should never re-learn ("match suppliers on CIF, never on address")
- "counterparty_note": a dealing rule about one supplier/landlord/platform ("goes quiet when it is their fault")
- "decision": a decision that now needs making

Reply with a JSON array only, no prose: [{"entity_code": "BM"|"IFL"|"BBH"|…, "pattern": "one or two sentences", "evidence_ids": ["<id>", …], "proposed_target": "register"|"counterparty_note"|"decision"}]. Use BBH for a pattern that spans entities. Cite only ids that appear in the log you were given. If nothing has formed, reply [].`;

function fmt(r: ObservationRow) {
  return `${r.id} | ${r.entity_code || "?"} | ${(r.observed_at || "").slice(0, 10)} | ${r.domain || "-"} | ${r.source} | ${r.subject ? "re " + r.subject + " | " : ""}${r.body}`;
}

async function askClaude(rows: ObservationRow[]): Promise<{ patterns: Pattern[]; raw: string; usage: any; error: string | null }> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { patterns: [], raw: "", usage: null, error: "ANTHROPIC_API_KEY missing" };
  const log = rows.map(fmt).join("\n");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: MODEL, max_tokens: 4000, temperature: 0.2, system: SYSTEM,
      messages: [{ role: "user", content: `Observation log, ${rows.length} unsynthesised lines (id | entity | date | domain | source | subject | body):\n\n${log}\n\nWhat pattern has formed that nobody has named yet?` }],
    }),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) return { patterns: [], raw: "", usage: null, error: j?.error?.message || `anthropic ${r.status}` };
  const raw = String(j?.content?.[0]?.text || "").trim();
  const m = raw.match(/\[[\s\S]*\]/);
  let arr: any[] = [];
  try { arr = m ? JSON.parse(m[0]) : []; } catch { arr = []; }
  const ids = new Set(rows.map((x) => x.id));
  const patterns: Pattern[] = [];
  for (const p of Array.isArray(arr) ? arr : []) {
    const pattern = String(p?.pattern || "").replace(/\s+/g, " ").trim();
    if (!pattern) continue;
    const evidence_ids = (Array.isArray(p?.evidence_ids) ? p.evidence_ids : []).map(String).filter((id: string) => ids.has(id));
    const tgt = ["register", "counterparty_note", "decision"].includes(p?.proposed_target) ? p.proposed_target : "decision";
    patterns.push({ entity_code: String(p?.entity_code || "BBH").toUpperCase(), pattern, evidence_ids, proposed_target: tgt });
  }
  return { patterns, raw, usage: j?.usage || null, error: null };
}

export async function GET(req: NextRequest) { return run(req); }
export async function POST(req: NextRequest) { return run(req); }

async function run(req: NextRequest) {
  // ---- auth: scheduler secret (pg_cron) or Bearer CRON_SECRET (hand / Vercel)
  const schedSecret = req.headers.get("x-scheduler-secret") || "";
  const anon = supabaseServer();
  let mode: "secret" | "service" | null = null;
  if (schedSecret) {
    const { data: ok } = await anon.rpc("observations_synthesis_secret_ok", { p_secret: schedSecret });
    if (ok === true) mode = "secret";
  }
  if (!mode) {
    const cron = await cronAuthorized(req);
    if (!cron.ok) return NextResponse.json({ ok: false, error: "unauthorized", who: cron.who }, { status: 401 });
    if (!supabaseService()) return NextResponse.json({ ok: false, error: "no service key — call with x-scheduler-secret (Vault: observations_synthesis_secret)" }, { status: 503 });
    mode = "service";
  }
  const runId = await startRun("observations-synthesis", mode);
  const svc = supabaseService();

  // ---- pull: every unsynthesised row, one query
  let rows: ObservationRow[] = [];
  if (mode === "secret") {
    const { data, error } = await anon.rpc("observations_synthesis_pull", { p_secret: schedSecret });
    if (error) { await finishRun(runId, false, null, error.message); return NextResponse.json({ ok: false, error: error.message }, { status: 500 }); }
    rows = (data || []) as ObservationRow[];
  } else {
    const { data, error } = await svc!.from("observations").select("*").is("synthesised_at", null).order("entity_code").order("observed_at");
    if (error) { await finishRun(runId, false, null, error.message); return NextResponse.json({ ok: false, error: error.message }, { status: 500 }); }
    rows = (data || []) as ObservationRow[];
  }
  const total = rows.length;
  if (rows.length > MAX_ROWS) rows = rows.slice(0, MAX_ROWS);   // stamp only what was actually read by the model
  if (!rows.length) {
    await finishRun(runId, true, { read: 0, patterns: 0 });
    return NextResponse.json({ ok: true, mode, read: 0, patterns: 0, model: MODEL });
  }

  // ---- ask
  const a = await askClaude(rows);
  if (a.error) { await finishRun(runId, false, { read: rows.length }, a.error); return NextResponse.json({ ok: false, error: a.error, read: rows.length }, { status: 502 }); }

  // ---- commit: candidates → observation_patterns, stamp every row read
  const readIds = rows.map((r) => r.id);
  let commit: any = null;
  if (mode === "secret") {
    const { data, error } = await anon.rpc("observations_synthesis_commit", { p_secret: schedSecret, p_read_ids: readIds, p_patterns: a.patterns });
    if (error) { await finishRun(runId, false, { read: rows.length }, error.message); return NextResponse.json({ ok: false, error: error.message }, { status: 500 }); }
    commit = data;
  } else {
    // Service role is not gated by the Vault secret: do the two writes directly.
    const run_id = crypto.randomUUID();
    let n = 0;
    for (const p of a.patterns) {
      const { data: eid } = await svc!.rpc("entity_id_for_code", { p_code: p.entity_code });
      if (!eid) continue;
      const { error } = await svc!.from("observation_patterns").insert({ entity_id: eid, entity_code: p.entity_code, pattern: p.pattern, evidence_ids: p.evidence_ids, proposed_target: p.proposed_target, run_id });
      if (!error) n += 1;
    }
    const { data: stamped, error } = await svc!.from("observations").update({ synthesised_at: new Date().toISOString() }).in("id", readIds).is("synthesised_at", null).select("id");
    if (error) { await finishRun(runId, false, { read: rows.length }, error.message); return NextResponse.json({ ok: false, error: error.message }, { status: 500 }); }
    commit = { patterns: n, stamped: (stamped || []).length, run_id };
  }
  const out = { ok: true, mode, model: MODEL, read: rows.length, unread_remaining: total - rows.length, patterns: a.patterns.length, commit, usage: a.usage };
  await finishRun(runId, true, out);
  return NextResponse.json(out);
}
