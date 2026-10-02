// Canonical JSON for the confirm gate — sorted keys, undefined dropped — so
// the object the router built, the object the browser posts back and the
// object the edge function email-reply re-hashes all produce ONE sha256.
//
// PURE. No imports. This exact file is copied into
// supabase/functions/email-reply/canonical.ts (the test script asserts the
// two copies are byte-identical, like inbox.ts for the meta functions).
export function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonical(o[k])).join(",") + "}";
}

// What gets hashed: the action without the wire-only fields.
export function hashableAction(action: Record<string, unknown>): Record<string, unknown> {
  const { confirm_token: _c, turn_id: _t, ...rest } = action;
  return rest;
}
