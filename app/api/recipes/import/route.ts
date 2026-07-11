// POST /api/recipes/import
// Parse a single recipe payload and (optionally) commit it as a real recipe row.
//
// Body: { source, external_ref?, raw_content, entity_id?, commit?: boolean }
//   commit=false (default) -> parses, saves recipe_import row (status=parsed),
//                             returns parsed JSON for review
//   commit=true            -> upserts a recipes row + recipe_ingredients + recipe_steps,
//                             sets recipe_import.status=imported, returns { recipe_id }

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { parseRecipeContent, type ParsedRecipe } from "@/lib/recipes/parser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const source: string = body.source || "paste";
  const external_ref: string | null = body.external_ref || null;
  const raw_content: string = body.raw_content || "";
  const entity_id: string | null = body.entity_id || null;
  const commit: boolean = !!body.commit;
  const parsedOverride: ParsedRecipe | null = body.parsed || null; // UI-edited parse ready for commit

  if (!raw_content && !parsedOverride) {
    return NextResponse.json({ error: "raw_content required" }, { status: 400 });
  }

  const supabase = supabaseServer();

  // Log the import attempt up-front so we can retry / audit
  const { data: importRow, error: importErr } = await supabase
    .from("recipe_imports")
    .insert({ source, external_ref, raw_content, entity_id, status: "parsing" })
    .select("id")
    .single();
  if (importErr || !importRow) {
    return NextResponse.json({ error: "import_log_failed", detail: importErr?.message }, { status: 500 });
  }
  const importId: string = importRow.id;

  // Parse (or use the user-edited version)
  let parsed: ParsedRecipe;
  try {
    parsed = parsedOverride || (await parseRecipeContent(raw_content));
  } catch (e) {
    await supabase.from("recipe_imports").update({
      status: "failed",
      parse_error: (e as Error).message,
    }).eq("id", importId);
    return NextResponse.json({ error: "parse_failed", detail: (e as Error).message, import_id: importId }, { status: 422 });
  }

  await supabase.from("recipe_imports").update({
    status: "parsed",
    parsed_json: parsed as any,
  }).eq("id", importId);

  if (!commit) {
    return NextResponse.json({ import_id: importId, parsed });
  }

  // Commit — upsert the recipe row, ingredients, and steps
  const recipeInsert = {
    name: parsed.title,
    description: parsed.notes,
    servings: parsed.servings,
    yield_grams: parsed.yield_grams,
    prep_minutes: parsed.prep_minutes,
    cook_minutes: parsed.cook_minutes,
    difficulty: parsed.difficulty,
    source_import_id: importId,
    section: "imported",
  };
  const { data: recipeRow, error: recipeErr } = await supabase
    .from("recipes")
    .insert(recipeInsert)
    .select("id")
    .single();
  if (recipeErr || !recipeRow) {
    await supabase.from("recipe_imports").update({
      status: "failed",
      parse_error: `recipe insert: ${recipeErr?.message}`,
    }).eq("id", importId);
    return NextResponse.json({ error: "recipe_insert_failed", detail: recipeErr?.message, import_id: importId }, { status: 500 });
  }
  const recipeId: string = recipeRow.id;

  if (parsed.ingredients.length) {
    const rows = parsed.ingredients.map((i) => ({
      recipe_id: recipeId,
      ingredient_name: i.ingredient_name,
      name: i.ingredient_name, // legacy alias for existing UI code
      quantity: i.quantity,
      unit: i.unit,
      notes: i.notes,
      is_optional: i.is_optional,
      order_idx: i.order_idx,
      sort_order: i.order_idx, // legacy alias
    }));
    const { error } = await supabase.from("recipe_ingredients").insert(rows);
    if (error) {
      return NextResponse.json({ error: "ingredients_insert_failed", detail: error.message, recipe_id: recipeId }, { status: 500 });
    }
  }
  if (parsed.steps.length) {
    const rows = parsed.steps.map((s) => ({
      recipe_id: recipeId,
      order_idx: s.order_idx,
      body: s.body,
      minutes: s.minutes,
      temperature_c: s.temperature_c,
    }));
    const { error } = await supabase.from("recipe_steps").insert(rows);
    if (error) {
      return NextResponse.json({ error: "steps_insert_failed", detail: error.message, recipe_id: recipeId }, { status: 500 });
    }
  }

  await supabase.from("recipe_imports").update({
    status: "imported",
    imported_at: new Date().toISOString(),
  }).eq("id", importId);

  return NextResponse.json({
    import_id: importId,
    recipe_id: recipeId,
    summary: {
      title: parsed.title,
      ingredients: parsed.ingredients.length,
      steps: parsed.steps.length,
      language: parsed.language,
      parser: parsed.parser,
    },
  });
}
