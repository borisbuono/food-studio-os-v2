import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { requireManagerOf } from "@/lib/access/requireManager";
import { matchEntity } from "@/lib/capture/match";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/capture/match { entity: "BM" | "IFL" | "BBH" } — re-run the
// albarán ↔ invoice matcher over every open invoice of the entity.
export async function POST(req: NextRequest) {
  const sb = supabaseServer();
  const body = await req.json().catch(() => ({}));
  const entity = String(body?.entity || "").toUpperCase();
  if (!["BM", "IFL", "BBH", "UTOPIA"].includes(entity)) return NextResponse.json({ ok: false, error: "entity required" }, { status: 400 });
  const gate = await requireManagerOf(sb as any, entity);
  if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  const report = await matchEntity(sb as any, entity);
  return NextResponse.json({ ok: true, entity, report });
}
