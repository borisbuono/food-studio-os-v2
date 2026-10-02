import { supabaseServer } from "@/lib/supabaseServer";
import { registerWrite, readRegister, isRegisterKind, REGISTER_KINDS } from "@/lib/register";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The register (Foundation §3 store 1) over HTTP, for signed-in callers.
//   POST /api/register { entity_code, kind, body, due?, source? } → { ok, id }
//   GET  /api/register?entity=BM&kind=decision&open=1&limit=100 → { ok, rows }
// One write path: the SQL RPC register_write(); RLS of the caller applies, so a
// cook cannot write into a house they are not a member of (403).

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return Response.json({ ok: false, error: "auth" }, { status: 401 });
  const entity_code = String(body?.entity_code || "").trim();
  if (!entity_code) return Response.json({ ok: false, error: "entity_code required" }, { status: 400 });
  if (!isRegisterKind(body?.kind)) return Response.json({ ok: false, error: "kind must be one of " + REGISTER_KINDS.join(", ") }, { status: 400 });
  const source = String(body?.source || "app").toLowerCase().replace(/[^a-z0-9_.-]/g, "_").slice(0, 40) || "app";
  const r = await registerWrite(sb, { entity_code, kind: body.kind, body: String(body?.body || ""), due: body?.due || null, source });
  if ("error" in r) return Response.json({ ok: false, error: r.error }, { status: r.status });
  return Response.json({ ok: true, id: r.id });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return Response.json({ ok: false, error: "auth" }, { status: 401 });
  const kind = url.searchParams.get("kind");
  const rows = await readRegister(sb, {
    entity_code: url.searchParams.get("entity"),
    kind: isRegisterKind(kind) ? kind : null,
    open_only: url.searchParams.get("open") === "1",
    limit: Number(url.searchParams.get("limit") || 100),
  });
  return Response.json({ ok: true, rows });
}
