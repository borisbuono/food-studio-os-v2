import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { computeRecipeCost, persistRecipeCost, type Confidence } from "@/lib/recipes/computeCost";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isUuid(x: any): x is string {
  return typeof x === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
}

// POST /api/recipes/compute-all?entity=<uuid>
// Batches computeRecipeCost across every active recipe for an entity and
// persists. Returns per-tier counts so the ship script / cron can log the
// state of the world.
export async function POST(req: Request) {
  const url = new URL(req.url);
  const entity = url.searchParams.get("entity");
  if (!isUuid(entity)) return NextResponse.json({ ok: false, error: "entity uuid required" }, { status: 400 });

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return NextResponse.json({ ok: false, error: "not authenticated" }, { status: 401 });

  const { data: recipes, error } = await sb
    .from("recipes")
    .select("id, name")
    .eq("entity_id", entity)
    .eq("is_active", true);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const tallies: Record<Confidence, number> = { high: 0, medium: 0, low: 0, missing: 0 };
  const failed: Array<{ id: string; name?: string; error: string }> = [];
  let processed = 0;

  for (const r of (recipes as any[]) || []) {
    try {
      const res = await computeRecipeCost(sb, r.id);
      await persistRecipeCost(sb, res);
      tallies[res.confidence]++;
      processed++;
    } catch (e: any) {
      failed.push({ id: r.id, name: r.name, error: String(e?.message || e) });
    }
  }

  return NextResponse.json({
    ok: true,
    entity_id: entity,
    processed,
    total: (recipes || []).length,
    tallies,
    failed,
  });
}
