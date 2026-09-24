import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Chef v3 — GET /api/chef/keyterms?entity=<uuid>
//
// Vocabulary hints for Deepgram Nova-3 keyterm prompting: the words a chef
// actually says at the pass — dish names, colleagues, suppliers — that a
// generic model mis-hears. Priority recipes > staff > providers, 100 cap
// (Deepgram's limit per request). Whisper ignores these; harmless to fetch.

const CAP = 100;
const MAX_LEN = 40;

function isUuid(x: unknown): x is string {
  return typeof x === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
}

function clean(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const t = name.replace(/\s+/g, " ").trim();
  if (!t || t.length > MAX_LEN) return null;
  return t;
}

export async function GET(req: NextRequest) {
  const entity = req.nextUrl.searchParams.get("entity");
  if (!isUuid(entity)) return NextResponse.json({ ok: false, error: "entity uuid required" }, { status: 400 });

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return NextResponse.json({ ok: false, error: "not authenticated" }, { status: 401 });

  const [recipesR, membersR, providersR] = await Promise.all([
    sb.from("recipes").select("name").eq("entity_id", entity).eq("is_active", true).order("name").limit(300),
    // Staff = active memberships of this entity → team_members.name.
    sb.from("memberships").select("team_members(name)").eq("entity_id", entity).eq("status", "active").limit(200),
    // Providers table is global (one supplier list across houses).
    sb.from("providers").select("name").order("name").limit(100),
  ]);

  const seen = new Set<string>();
  const terms: string[] = [];
  const push = (raw: unknown) => {
    const t = clean(raw);
    if (!t) return;
    const k = t.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    terms.push(t);
  };

  for (const r of (recipesR.data || []) as any[]) push(r.name);

  // First names only — "Marta" is what gets said at the pass, not "Marta García".
  for (const m of (membersR.data || []) as any[]) {
    const tm = Array.isArray(m.team_members) ? m.team_members[0] : m.team_members;
    const first = typeof tm?.name === "string" ? tm.name.trim().split(/\s+/)[0] : null;
    push(first);
  }

  for (const p of (providersR.data || []) as any[]) push(p.name);

  return NextResponse.json(
    { ok: true, terms: terms.slice(0, CAP) },
    { headers: { "Cache-Control": "private, max-age=600" } },
  );
}
