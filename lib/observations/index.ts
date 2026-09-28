// The observation log — Foundation §3 store 2. Server-only.
//
// One line, append-only, unstructured, never read at session open. Every
// write in the app goes through observe() here (Chef `remember`, POST
// /api/observations); lab agents call the SQL RPC `observe()` directly from
// the Supabase MCP. The DB enforces the rules (see
// supabase/migrations/20260928_observations_log.sql): entity_code is derived,
// UPDATE may touch only synthesised_at / promoted_to, DELETE is service-role
// only, a staff member's name as `subject` is refused.
//
// READ RULE: nothing on the session-open path (AppChrome, /api/ask context,
// chef/now, predict.ts, the brief) may import readObservations(). Its only
// callers are GET /api/observations (an agent reading its own domain or a
// counterparty before dealing with it) and the weekly synthesis job.

import type { SupabaseClient } from "@supabase/supabase-js";

export const OBSERVATION_DOMAINS = ["finance", "purchasing", "comms", "legal", "hiring", "menu", "web", "other"] as const;
export type ObservationDomain = (typeof OBSERVATION_DOMAINS)[number];

export type ObservationRow = {
  id: string;
  entity_id: string;
  entity_code: string | null;
  observed_at: string;
  body: string;
  domain: string | null;
  source: string;
  subject: string | null;
  synthesised_at: string | null;
  promoted_to: string | null;
};

export type ObserveInput = {
  entity_code?: string | null;   // BM | IFL | BBH | UTOPIA … (either this or entity_id)
  entity_id?: string | null;
  body: string;
  source: string;
  domain?: string | null;
  subject?: string | null;
};

export type ObserveResult =
  | { ok: true; id: string }
  | { ok: false; error: string; status: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normaliseDomain(d: unknown): ObservationDomain | null {
  const s = String(d ?? "").trim().toLowerCase();
  if (!s) return null;
  return (OBSERVATION_DOMAINS as readonly string[]).includes(s) ? (s as ObservationDomain) : "other";
}

// Insert one line. `sb` is the caller's client — the session client from a
// route (RLS applies: entity members only) or the service client from a job.
export async function observe(sb: SupabaseClient, input: ObserveInput): Promise<ObserveResult> {
  const body = String(input.body ?? "").replace(/\s+/g, " ").trim();
  const source = String(input.source ?? "").trim();
  if (!body) return { ok: false, error: "body required", status: 400 };
  if (!source) return { ok: false, error: "source required", status: 400 };
  const entity_id = input.entity_id && UUID.test(String(input.entity_id)) ? String(input.entity_id) : null;
  const entity_code = String(input.entity_code ?? "").trim() || null;
  if (!entity_id && !entity_code) return { ok: false, error: "entity_code or entity_id required", status: 400 };

  const row: Record<string, unknown> = {
    body: body.slice(0, 2000), source: source.slice(0, 80),
    domain: normaliseDomain(input.domain), subject: String(input.subject ?? "").trim().slice(0, 200) || null,
  };
  if (entity_id) row.entity_id = entity_id; else row.entity_code = entity_code;
  // The BEFORE INSERT trigger resolves the other key and derives entity_code.
  const { data, error } = await sb.from("observations").insert(row).select("id").maybeSingle();
  if (error) {
    const msg = error.message || "insert failed";
    // 42501 = RLS refused (not a member of that entity); 23503 = unknown entity;
    // 23514 = trigger refused (empty body / staff subject).
    const status = error.code === "42501" ? 403 : error.code === "23503" ? 404 : error.code === "23514" ? 422 : 500;
    return { ok: false, error: msg, status };
  }
  if (!data) return { ok: false, error: "not a member of that entity", status: 403 };
  return { ok: true, id: (data as any).id as string };
}

export type ReadFilter = {
  entity?: string | null;   // code or uuid
  domain?: string | null;
  subject?: string | null;  // case-insensitive exact match
  since?: string | null;    // ISO date/time
  limit?: number;
};

// Entity-scoped read for an agent (never for the shell). RLS narrows to the
// caller's entities; the filter narrows further.
export async function readObservations(sb: SupabaseClient, f: ReadFilter): Promise<{ rows: ObservationRow[]; error: string | null }> {
  let q = sb.from("observations")
    .select("id, entity_id, entity_code, observed_at, body, domain, source, subject, synthesised_at, promoted_to")
    .order("observed_at", { ascending: false })
    .limit(Math.min(Math.max(Number(f.limit) || 200, 1), 1000));
  const ent = String(f.entity ?? "").trim();
  if (ent) {
    if (UUID.test(ent)) q = q.eq("entity_id", ent);
    else q = q.eq("entity_code", ent.toUpperCase() === "TALLER" ? "IFL" : ent.toUpperCase() === "HOLDINGS" ? "BBH" : ent.toUpperCase());
  }
  const dom = normaliseDomain(f.domain);
  if (f.domain && dom) q = q.eq("domain", dom);
  const subj = String(f.subject ?? "").trim();
  if (subj) q = q.ilike("subject", subj);
  const since = String(f.since ?? "").trim();
  if (since && !Number.isNaN(Date.parse(since))) q = q.gte("observed_at", new Date(since).toISOString());
  const { data, error } = await q;
  return { rows: (data || []) as ObservationRow[], error: error?.message || null };
}
