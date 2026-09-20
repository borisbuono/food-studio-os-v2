import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { ENTITY_CODE_FOR_PL, normalizeName, singularize } from "@/lib/recipes/computeCost";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isUuid(x: any): x is string {
  return typeof x === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
}

// POST /api/ingredient-aliases/seed?entity=<uuid>
//
// Extracts distinct raw_product_text from purchase_lines for the entity
// and clusters obvious case/plural variants (e.g. "Tomate" / "tomate" /
// "Tomates" all → canonical "Tomate"). Insertions skip rows that already
// exist. Returns a per-cluster preview so Boris can eyeball what got
// linked.
//
// PHILOSOPHY: rule-based, not fuzzy. If two normalised strings collapse
// to the same key AFTER lowercase + accent strip + singularise, they're
// aliases. Anything else is left unmatched for a human.

export async function POST(req: Request) {
  const url = new URL(req.url);
  const entity = url.searchParams.get("entity");
  if (!isUuid(entity)) return NextResponse.json({ ok: false, error: "entity uuid required" }, { status: 400 });

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return NextResponse.json({ ok: false, error: "not authenticated" }, { status: 401 });

  const entityCode = ENTITY_CODE_FOR_PL[entity];
  if (!entityCode) return NextResponse.json({ ok: false, error: "entity_code not mapped" }, { status: 400 });

  // Pull up to N recent purchase lines for this entity — sample enough to
  // cover the common ingredients without paging forever.
  const { data: rows, error } = await sb
    .from("purchase_lines")
    .select("raw_product_text, unit, qty, line_total_eur")
    .eq("entity_code", entityCode)
    .not("raw_product_text", "is", null)
    .order("doc_date", { ascending: false })
    .limit(5000);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  // Cluster by normalised singularised key.
  type Cluster = {
    key: string;
    canonical: string; // first-seen well-formed variant, title-cased
    aliases: Set<string>;
    hits: number;
    units: Record<string, number>;
  };
  const clusters: Record<string, Cluster> = {};

  for (const row of (rows as any[]) || []) {
    const raw = String(row.raw_product_text || "").trim();
    if (!raw) continue;
    const norm = normalizeName(raw);
    if (!norm) continue;
    const key = singularize(norm);
    if (!clusters[key]) {
      clusters[key] = {
        key,
        canonical: titleCase(raw),
        aliases: new Set([raw]),
        hits: 0,
        units: {},
      };
    }
    clusters[key].aliases.add(raw);
    clusters[key].hits++;
    const unit = String(row.unit || "").toLowerCase().trim();
    if (unit) clusters[key].units[unit] = (clusters[key].units[unit] || 0) + 1;
  }

  // Load existing aliases so we can skip inserts.
  const { data: existingRows } = await sb
    .from("ingredient_aliases")
    .select("alias")
    .eq("entity_id", entity);
  const existing = new Set((existingRows as any[] | null || []).map((r) => normalizeName(String(r.alias))));

  const toInsert: Array<{ entity_id: string; canonical_name: string; alias: string; unit: string | null; unit_conversion: number }> = [];
  const skipped: string[] = [];
  const previewClusters: Array<{ canonical: string; alias_count: number; hits: number; unit: string | null }> = [];

  for (const c of Object.values(clusters)) {
    // Only auto-cluster when there are 2+ variants collapsing to the same
    // key. A single variant → we still add the row so recipes using the
    // canonical spelling can resolve, but flag it as a boring alias.
    const unit = pickTop(c.units);
    previewClusters.push({
      canonical: c.canonical,
      alias_count: c.aliases.size,
      hits: c.hits,
      unit: unit,
    });
    for (const a of c.aliases) {
      if (existing.has(normalizeName(a))) { skipped.push(a); continue; }
      toInsert.push({
        entity_id: entity,
        canonical_name: c.canonical,
        alias: a,
        unit: unit || null,
        unit_conversion: 1,
      });
    }
  }

  // Sort preview by hits descending so Boris sees the heavy hitters first.
  previewClusters.sort((a, b) => b.hits - a.hits);

  let inserted = 0;
  if (toInsert.length > 0) {
    // Chunked insert; onConflict do nothing on (entity_id, alias) via unique index.
    const chunks: typeof toInsert[] = [];
    for (let i = 0; i < toInsert.length; i += 500) chunks.push(toInsert.slice(i, i + 500));
    for (const chunk of chunks) {
      const { count, error: iErr } = await sb
        .from("ingredient_aliases")
        .upsert(chunk, { onConflict: "entity_id,alias", ignoreDuplicates: true, count: "exact" });
      if (iErr) return NextResponse.json({ ok: false, error: iErr.message, inserted }, { status: 500 });
      inserted += count || chunk.length;
    }
  }

  return NextResponse.json({
    ok: true,
    entity_id: entity,
    scanned_rows: (rows || []).length,
    clusters: previewClusters.length,
    inserted,
    skipped_existing: skipped.length,
    top_clusters: previewClusters.slice(0, 25),
  });
}

function titleCase(s: string): string {
  const t = s.trim().replace(/\s+/g, " ");
  if (!t) return t;
  // Preserve original casing if it already has upper-case letters (e.g.
  // "TOMATE RAF" or "Aceite d'Oliva"). Otherwise Title Case.
  if (/[A-Z]/.test(t)) return t;
  return t.replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

function pickTop(counts: Record<string, number>): string | null {
  let best: string | null = null;
  let n = 0;
  for (const [k, v] of Object.entries(counts)) {
    if (v > n) { best = k; n = v; }
  }
  return best;
}
