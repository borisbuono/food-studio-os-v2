import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { supabaseService } from "@/lib/supabaseService";
import { recomputeRecipes, refreshMenuMargin } from "@/lib/recipes/recompute";
import { ENTITY_SHORT, type EntityKey } from "@/lib/entities";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/recipes/compute-all-entities
//
// Nightly refresh: recompute cost for every active recipe of every entity
// that has recipes, persist onto recipes.cost_*, then republish every
// matched menu_dish_costing row. Called by /api/cron/pos-nightly (Hobby
// plan caps us at 3 Vercel crons, so this piggybacks instead of getting
// its own schedule). Catches everything the ingest hook can't see: bulk
// SQL imports, alias edits, recipe edits, and prices ageing past 30 days.
//
// Auth: `Authorization: Bearer $CRON_SECRET` (uses the service-role client
// — without it RLS would hand an anon cron zero rows), or a signed-in
// user (runs under their session).

async function pickClient(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") || "";
  if (secret && auth === `Bearer ${secret}`) {
    const svc = supabaseService();
    if (!svc) return { error: "SUPABASE_SERVICE_ROLE_KEY not set — cron cannot read recipes past RLS" as const };
    return { sb: svc, via: "cron" as const };
  }
  const sb = supabaseServer();
  const { data } = await sb.auth.getUser();
  if (!data?.user) return { unauthorized: true as const };
  return { sb, via: "user" as const };
}

export async function POST(req: NextRequest) {
  const picked = await pickClient(req);
  if ("unauthorized" in picked) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if ("error" in picked) return NextResponse.json({ ok: false, skipped: picked.error }, { status: 503 });
  const { sb, via } = picked;
  const started = Date.now();

  const { data: recipes, error } = await sb
    .from("recipes")
    .select("id, entity_id")
    .eq("is_active", true)
    .not("entity_id", "is", null);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const byEntity = new Map<string, string[]>();
  for (const r of (recipes as any[]) || []) {
    const list = byEntity.get(r.entity_id) || [];
    list.push(r.id);
    byEntity.set(r.entity_id, list);
  }

  const perEntity: any[] = [];
  const allResults = new Map<string, any>();
  for (const [entityId, ids] of byEntity) {
    const sum = await recomputeRecipes(sb, ids);
    for (const [k, v] of sum.results) allResults.set(k, v);
    perEntity.push({
      entity_id: entityId,
      entity: ENTITY_SHORT[entityId as EntityKey] ?? entityId,
      total: ids.length,
      processed: sum.processed,
      tallies: sum.tallies,
      failed: sum.failed.slice(0, 20),
      failed_count: sum.failed.length,
    });
  }

  const menu = await refreshMenuMargin(sb, { results: allResults });

  try {
    await sb.from("assistant_actions").insert({
      user_id: null,
      action_kind: "recipe_cost",
      action_type: "recipes.compute_all_entities",
      entity_code: null,
      target_table: "recipes",
      payload: {
        via,
        ms: Date.now() - started,
        per_entity: perEntity.map(({ failed, ...p }) => p),
        menu_rows: menu.rows,
        menu_rows_updated: menu.updated,
        menu_error: menu.error ?? null,
      },
      reversible: false,
    });
  } catch {
    /* audit is best-effort */
  }

  return NextResponse.json({
    ok: true,
    via,
    ms: Date.now() - started,
    per_entity: perEntity,
    menu_rows: menu.rows,
    menu_rows_updated: menu.updated,
    menu_error: menu.error ?? null,
  });
}
