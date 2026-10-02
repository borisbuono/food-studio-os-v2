// lib/email/register.ts — one write into the register for a "needs you" line.
//
// Foundation principle 2: state is written, never reconstructed. A fiscal /
// legal mail (AEAT, TGSS, lawyer, landlord, bank) becomes a register line
// with its deadline; the OS never drafts it. The sec/hardening build is
// turning master_todos into the per-entity register with ONE write RPC
// `register_write(entity_code, kind, body, due, source)`. Until that RPC
// exists we insert into master_todos directly with today's columns (and
// only the entity codes its CHECK accepts). We never touch its policies.

import type { SupabaseClient } from "@supabase/supabase-js";

const LEGACY_CODES = new Set(["BM", "IFL", "BBH"]);

export async function registerNeedsYou(svc: SupabaseClient, a: {
  entity_code: string | null; entity_id: string; title: string; body: string; due: string | null; source: string; context?: Record<string, unknown>;
}): Promise<{ id: string | null; via: "register_write" | "master_todos" | "none"; error?: string }> {
  // 1) the register RPC, when the sec build has landed it
  try {
    const { data, error } = await svc.rpc("register_write", {
      entity_code: a.entity_code, kind: "needs_you", body: `${a.title}\n${a.body}`.slice(0, 2000), due: a.due, source: a.source,
    });
    if (!error && data) return { id: String(data), via: "register_write" };
    if (error && !/function .*register_write.* does not exist|42883|PGRST202/i.test(error.message + (error as any).code)) {
      return { id: null, via: "none", error: error.message };
    }
  } catch { /* fall through */ }
  // 2) today's master_todos
  const code = a.entity_code && LEGACY_CODES.has(a.entity_code) ? a.entity_code : null;
  const { data, error } = await svc.from("master_todos").insert({
    entity_code: code, source: "system_generated", title: a.title.slice(0, 200), description: a.body.slice(0, 2000),
    status: "pending", priority: a.due ? 2 : 3, impact_score: 3, due_at: a.due ? `${a.due}T09:00:00Z` : null,
    context: { kind: "needs_you", via: a.source, entity_id: a.entity_id, ...(a.context || {}) },
  }).select("id").maybeSingle();
  if (error) return { id: null, via: "none", error: error.message };
  return { id: (data as any)?.id || null, via: "master_todos" };
}
