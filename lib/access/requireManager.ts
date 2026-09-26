// Server-side membership + role gate for API routes that take an entity from
// the request body and then run privileged work (service-role jobs, Anthropic
// calls, bulk inserts).
//
// Why (security audit 2026-09-26, P0-5): five legacy routes accepted
// `entity: "BM" | "IFL" | "BBH"` from any signed-in user of any tenant and ran
// service-role jobs for that venue. RLS is not the backstop on those paths
// because the work happens through supabaseJob(). This helper is the same
// check the Sep-2026 features (hiring, shifts, rates) do inline:
// `fn_is_entity_manager(uid, ent)` — but it also accepts the legacy codes so
// the finance / Fresto routes can adopt it without changing their wire shape.
//
// Usage:
//   const gate = await requireManagerOf(sb, body.entity);
//   if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });

import type { SupabaseClient } from "@supabase/supabase-js";
import { E_BM, E_HOLDINGS, E_TALLER, E_UTOPIA } from "@/lib/entities";

export type AccessGate =
  | { ok: true; uid: string; entity_id: string | null }
  | { ok: false; status: 400 | 401 | 403; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Legacy codes still on the wire for finance / Fresto routes. Anything else
// goes through resolve_entity() (slug / code → uuid, RLS-scoped).
const LEGACY_CODE_TO_ID: Record<string, string> = {
  BM: E_BM,
  IFL: E_TALLER,
  IFS: E_TALLER,
  TALLER: E_TALLER,
  BBH: E_HOLDINGS,
  HOLDINGS: E_HOLDINGS,
  UTOPIA: E_UTOPIA,
};

export async function resolveEntityId(sb: SupabaseClient, entity: string | null | undefined): Promise<string | null> {
  const raw = String(entity || "").trim();
  if (!raw) return null;
  if (UUID_RE.test(raw)) return raw.toLowerCase();
  const legacy = LEGACY_CODE_TO_ID[raw.toUpperCase()];
  if (legacy) return legacy;
  const { data } = await sb.rpc("resolve_entity", { p_code: raw });
  return typeof data === "string" && UUID_RE.test(data) ? data : null;
}

async function currentUid(sb: SupabaseClient): Promise<string | null> {
  const { data } = await sb.auth.getUser();
  return data?.user?.id || null;
}

// Signed in AND an active owner/manager-class member of `entity` (uuid, slug
// or legacy code). Platform owner (owner of the holding) passes for any entity.
export async function requireManagerOf(sb: SupabaseClient, entity: string | null | undefined): Promise<AccessGate> {
  const uid = await currentUid(sb);
  if (!uid) return { ok: false, status: 401, error: "unauthorized" };
  const entity_id = await resolveEntityId(sb, entity);
  if (!entity_id) return { ok: false, status: 400, error: "unknown entity" };
  const { data: mgr } = await sb.rpc("fn_is_entity_manager", { uid, ent: entity_id });
  if (mgr === true) return { ok: true, uid, entity_id };
  const { data: platform } = await sb.rpc("app_is_platform_owner");
  if (platform === true) return { ok: true, uid, entity_id };
  return { ok: false, status: 403, error: "forbidden: manager of this entity only" };
}

// Signed in AND a manager of EVERY entity in the list (finance scans accept
// `entities[]`).
export async function requireManagerOfAll(sb: SupabaseClient, entities: Array<string | null | undefined>): Promise<AccessGate> {
  let last: AccessGate = { ok: false, status: 400, error: "no entity" };
  for (const e of entities) {
    last = await requireManagerOf(sb, e);
    if (!last.ok) return last;
  }
  return last;
}

// Signed in AND owner of the holding company (Boris's admin surface: mailbox
// sweeps, orphan reprocessing).
export async function requirePlatformOwner(sb: SupabaseClient): Promise<AccessGate> {
  const uid = await currentUid(sb);
  if (!uid) return { ok: false, status: 401, error: "unauthorized" };
  const { data: platform } = await sb.rpc("app_is_platform_owner");
  if (platform === true) return { ok: true, uid, entity_id: null };
  return { ok: false, status: 403, error: "forbidden: platform owner only" };
}

// Signed in AND holds at least one active membership somewhere. For routes
// with no entity on the wire that still spend money (vision scans): a
// stranger with a login but no team must not be able to burn credit.
export async function requireAnyMembership(sb: SupabaseClient): Promise<AccessGate> {
  const uid = await currentUid(sb);
  if (!uid) return { ok: false, status: 401, error: "unauthorized" };
  const { data } = await sb.rpc("current_person_entities");
  const n = Array.isArray(data) ? data.length : 0;
  if (n > 0) return { ok: true, uid, entity_id: null };
  return { ok: false, status: 403, error: "forbidden: no active membership" };
}
