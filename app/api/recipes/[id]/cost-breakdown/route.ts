import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { computeRecipeCost } from "@/lib/recipes/computeCost";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/recipes/[id]/cost-breakdown
// Live compute (no persist) — returns per-ingredient breakdown for the
// RecipeDetail cost section.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return NextResponse.json({ ok: false, error: "not authenticated" }, { status: 401 });

  try {
    const res = await computeRecipeCost(sb, params.id);
    return NextResponse.json({ ok: true, ...res });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
