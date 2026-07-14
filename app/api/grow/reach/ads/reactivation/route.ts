import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { REACTIVATION_STEPS } from "@/lib/social/reactivation";

export const runtime = "nodejs";

// POST /api/grow/reach/ads/reactivation
//
// Body: { entity, platform, step_key, done?, notes? }
//
// Upserts the (entity, platform, step_key) row in
// platform_reactivation_state. Returns done_at so the client can render the
// "checked at" timestamp without a re-fetch.

const VALID_KEYS = new Set(REACTIVATION_STEPS.map((s) => s.key));

export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const entity = String(b.entity || "");
    if (!(entity === "IFL" || entity === "BM" || entity === "BBH" || entity.startsWith("ADV-"))) {
      return NextResponse.json({ ok: false, error: "invalid entity" }, { status: 400 });
    }
    const platform = String(b.platform || "meta-ads");
    const step_key = String(b.step_key || "");
    if (!VALID_KEYS.has(step_key)) {
      return NextResponse.json({ ok: false, error: `unknown step_key ${step_key}` }, { status: 400 });
    }

    const sb = supabaseServer();
    const { data: user } = await sb.auth.getUser();
    const uid = user.user?.id || null;

    // Read existing so we know whether we're flipping `done`.
    const { data: existing } = await sb.from("platform_reactivation_state")
      .select("done,notes,done_at")
      .eq("entity_code", entity).eq("platform", platform).eq("step_key", step_key)
      .maybeSingle();

    const wantDone = typeof b.done === "boolean" ? Boolean(b.done) : Boolean(existing?.done);
    const wantNotes = typeof b.notes === "string" ? String(b.notes) : (existing?.notes ?? null);
    const done_at = wantDone
      ? (existing?.done ? existing?.done_at : new Date().toISOString())
      : null;
    const done_by = wantDone ? uid : null;

    const { error } = await sb.from("platform_reactivation_state").upsert({
      entity_code: entity,
      platform,
      step_key,
      done: wantDone,
      notes: wantNotes,
      done_at,
      done_by,
    }, { onConflict: "entity_code,platform,step_key" });
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, done: wantDone, done_at });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 400 });
  }
}
