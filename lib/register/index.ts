// The register — Foundation §3 store 1 (`master_todos`). Server-only.
//
// Six things get written, and only these six: a decision (and what was
// rejected), an identifier costly to re-derive, a dated commitment, a
// constraint learned the hard way, a correction, a pointer to the primary
// artifact. Every write in the app goes through registerWrite() here (Chef
// `todo_add`, POST /api/register, POST /api/master-todo); lab agents (PA, COM,
// CEO, finance) call the SQL RPC `register_write()` directly from the
// Supabase MCP. The DB enforces the rules (see
// supabase/migrations/20261002_security_s1_register_tenant_key.sql): the
// tenant key is `entity_id` (derived from the code by trigger), RLS of the
// caller decides who may write where, `kind` is one of the six, a commitment
// is `pending` (it drives action), the other five are `noted` (they are facts).
//
// READ RULE: the register IS read at session open (unlike the observation
// log) — but only `kind`, `title`, `due_at`, `status`, never context blobs.

import type { SupabaseClient } from "@supabase/supabase-js";

export const REGISTER_KINDS = ["decision", "identifier", "commitment", "constraint", "correction", "pointer"] as const;
export type RegisterKind = (typeof REGISTER_KINDS)[number];

export function isRegisterKind(x: unknown): x is RegisterKind {
  return typeof x === "string" && (REGISTER_KINDS as readonly string[]).includes(x);
}

export type RegisterWriteInput = {
  entity_code: string;            // BM | IFL | BBH | UTOPIA | any slug
  kind: RegisterKind;
  body: string;                   // one line; the DB keeps 500 chars in `title`, the rest in context.body_full
  due?: string | Date | null;     // commitments only (ISO)
  source: string;                 // who wrote it: chef | pa | com | ceo | user_added | …
};

export type RegisterRow = {
  id: string;
  entity_id: string | null;
  entity_code: string | null;
  kind: RegisterKind | null;
  title: string;
  status: string;
  due_at: string | null;
  source: string;
  created_at: string;
};

/** Statuses that mean "not an open task". `noted` = a register fact. */
export const REGISTER_CLOSED_STATUSES = ["completed", "deferred", "noted"] as const;
/** PostgREST filter literal for `.not("status", "in", …)`. */
export const REGISTER_CLOSED_IN = "(completed,deferred,noted)";

export async function registerWrite(sb: SupabaseClient, input: RegisterWriteInput): Promise<{ id: string } | { error: string; status: number }> {
  if (!isRegisterKind(input.kind)) return { error: "kind must be one of " + REGISTER_KINDS.join(", "), status: 400 };
  const body = String(input.body || "").replace(/\s+/g, " ").trim();
  if (!body) return { error: "body required", status: 400 };
  const due = input.due ? (input.due instanceof Date ? input.due.toISOString() : String(input.due)) : null;
  const { data, error } = await sb.rpc("register_write", {
    p_entity_code: input.entity_code,
    p_kind: input.kind,
    p_body: body,
    p_due: due,
    p_source: input.source || "app",
  });
  if (error) {
    // 42501 = RLS refused (not a member of that entity); 23503 = unknown entity; 23514 = bad kind/body.
    const status = /42501|row-level security/.test(error.message + (error as any).code) ? 403
      : /23503|unknown entity/.test(error.message + (error as any).code) ? 404 : 400;
    return { error: error.message, status };
  }
  return { id: String(data) };
}

export async function readRegister(sb: SupabaseClient, q: { entity_code?: string | null; kind?: RegisterKind | null; open_only?: boolean; limit?: number }): Promise<RegisterRow[]> {
  let s = sb.from("master_todos").select("id,entity_id,entity_code,kind,title,status,due_at,source,created_at")
    .order("created_at", { ascending: false }).limit(Math.min(Math.max(q.limit || 100, 1), 500));
  if (q.entity_code) s = s.eq("entity_code", q.entity_code);
  if (q.kind) s = s.eq("kind", q.kind);
  if (q.open_only) s = s.not("status", "in", REGISTER_CLOSED_IN);
  const { data } = await s;
  return (data || []) as RegisterRow[];
}
