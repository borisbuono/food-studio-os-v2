// POST /api/recipes/import/batch
// Bulk import — takes an array of items and runs the single-import flow for each.
// Body: { items: [{ source, external_ref?, raw_content, commit? }], commit?: boolean }
//
// Returns per-item outcomes so the UI can render a progress table.

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { parseRecipeContent, type ParsedRecipe } from "@/lib/recipes/parser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Item = { source: string; external_ref?: string; raw_content: string; commit?: boolean };

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const items: Item[] = Array.isArray(body.items) ? body.items : [];
  const commitAll: boolean = !!body.commit;
  if (!items.length) return NextResponse.json({ error: "items required" }, { status: 400 });

  const supabase = supabaseServer();
  const results: Array<{ external_ref: string | null; ok: boolean; import_id?: string; recipe_id?: string; error?: string; parsed?: ParsedRecipe }> = [];

  for (const item of items) {
    const commit = item.commit ?? commitAll;
    const external_ref = item.external_ref || null;
    if (!item.raw_content) {
      results.push({ external_ref, ok: false, error: "empty_raw_content" });
      continue;
    }
    const { data: importRow } = await supabase
      .from("recipe_imports")
      .insert({ source: item.source || "drive_folder", external_ref, raw_content: item.raw_content, status: "parsing" })
      .select("id")
      .single();
    const importId: string | undefined = importRow?.id;
    if (!importId) {
      results.push({ external_ref, ok: false, error: "import_log_failed" });
      continue;
    }

    let parsed: ParsedRecipe;
    try {
      parsed = await parseRecipeContent(item.raw_content);
    } catch (e) {
      await supabase.from("recipe_imports").update({ status: "failed", parse_error: (e as Error).message }).eq("id", importId);
      results.push({ external_ref, ok: false, import_id: importId, error: (e as Error).message });
      continue;
    }
    await supabase.from("recipe_imports").update({ status: "parsed", parsed_json: parsed as any }).eq("id", importId);

    if (!commit) {
      results.push({ external_ref, ok: true, import_id: importId, parsed });
      continue;
    }

    const { data: recipeRow } = await supabase.from("recipes").insert({
      name: parsed.title,
      description: parsed.notes,
      servings: parsed.servings,
      yield_grams: parsed.yield_grams,
      prep_minutes: parsed.prep_minutes,
      cook_minutes: parsed.cook_minutes,
      difficulty: parsed.difficulty,
      source_import_id: importId,
      section: "imported",
    }).select("id").single();
    const recipeId: string | undefined = recipeRow?.id;
    if (!recipeId) {
      results.push({ external_ref, ok: false, import_id: importId, error: "recipe_insert_failed" });
      continue;
    }

    if (parsed.ingredients.length) {
      await supabase.from("recipe_ingredients").insert(parsed.ingredients.map((i) => ({
        recipe_id: recipeId,
        ingredient_name: i.ingredient_name,
        name: i.ingredient_name,
        quantity: i.quantity,
        unit: i.unit,
        notes: i.notes,
        is_optional: i.is_optional,
        order_idx: i.order_idx,
        sort_order: i.order_idx,
      })));
    }
    if (parsed.steps.length) {
      await supabase.from("recipe_steps").insert(parsed.steps.map((s) => ({
        recipe_id: recipeId,
        order_idx: s.order_idx,
        body: s.body,
        minutes: s.minutes,
        temperature_c: s.temperature_c,
      })));
    }
    await supabase.from("recipe_imports").update({ status: "imported", imported_at: new Date().toISOString() }).eq("id", importId);
    results.push({ external_ref, ok: true, import_id: importId, recipe_id: recipeId });
  }

  return NextResponse.json({
    total: items.length,
    imported: results.filter((r) => r.ok && r.recipe_id).length,
    parsed: results.filter((r) => r.ok && !r.recipe_id).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  });
}
