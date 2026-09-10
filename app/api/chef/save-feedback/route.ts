import { supabaseServer } from "@/lib/supabaseServer";
import { ENTITY_TO_RESTAURANT, EntityKey } from "@/lib/entities";

export const runtime = "nodejs";

// POST /api/chef/save-feedback — persist an Assistant-proposed feedback item.
//
// WHY THIS EXISTS (2026-08-27 bug-triage pass):
// The orchestrator has always classified "this screen is confusing" / "this is
// broken" turns as a feedback action and /api/ask returns it to the FAB
// (lib/assistant/orchestrator.ts L557). The FAB stored it on the message
// (`feedback: d.feedback`) — and then dropped it on the floor. There was NO
// write path to the `feedback` table anywhere in the tree: the only reference
// was a single SELECT in app/grow/inbox/page.tsx. Net effect: the board took
// ZERO rows for 85 days (newest row 2026-06-03) while the intent chips still
// offered "feedback" as a category, so every operator report was silently lost.
//
// The DB was ready the whole time — RLS policy `fb_insert` allows an
// authenticated insert with author_id = auth.uid(). This route is the missing
// half. Mirrors the save-memory contract exactly so the FAB call site is
// symmetrical with saveMemory().
const KINDS = ["love", "idea", "bug", "confusing"] as const;

export async function POST(req: Request) {
  const { kind, body, route, entity, session_id } = await req.json();

  const text = typeof body === "string" ? body.trim() : "";
  if (!text) return Response.json({ ok: false, error: "body required" }, { status: 400 });

  // kind is CHECK-constrained in Postgres; fall back to the column default
  // rather than letting a bad model output 500 the insert.
  const k = (KINDS as readonly string[]).includes(kind) ? kind : "idea";

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return Response.json({ ok: false, error: "auth" }, { status: 401 });

  // author_id FKs to profiles(id) and RLS requires author_id = auth.uid(),
  // so the profile row must exist. Read it for the display fields too.
  const { data: prof } = await sb
    .from("profiles").select("id,name,role,restaurant_id").eq("id", uid).maybeSingle();
  if (!prof) return Response.json({ ok: false, error: "no profile" }, { status: 403 });

  const mapped = entity ? ENTITY_TO_RESTAURANT[entity as EntityKey] : undefined;
  const restaurantId = mapped || prof.restaurant_id || null;

  const { data, error } = await sb.from("feedback").insert({
    restaurant_id: restaurantId,
    route: typeof route === "string" ? route.slice(0, 200) : null,
    author_id: uid,
    author_name: prof.name || null,
    author_role: prof.role || null,
    kind: k,
    body: text.slice(0, 2000),
    // status/priority/metadata take their column defaults ('new'/'normal'/{}).
    metadata: session_id ? { session_id: String(session_id).slice(0, 100), source: "assistant_fab" } : { source: "assistant_fab" },
  }).select("id").maybeSingle();

  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true, id: data?.id });
}
