import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { RESTAURANT_TO_ENTITY } from "@/lib/entities";
import { mapDbRole } from "@/lib/roles";

export const dynamic = "force-dynamic";

// Returns the signed-in user's profile for the client shell (sidebar name/role,
// entity accent, admin gates). Diagnostic dump is gated behind ?dbg=1 so
// production responses never leak cookie names or access-token prefixes.
export async function GET(req: Request) {
  const wantDbg = new URL(req.url).searchParams.get("dbg") === "1";
  try {
    const supabase = supabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ profile: null });

    try { await supabase.rpc("sync_my_profile_from_invite"); } catch {}

    const { data: prof } = await supabase
      .from("profiles")
      .select("id,name,role,restaurant_id,color")
      .eq("id", user.id)
      .maybeSingle();

    if (!prof) return NextResponse.json({ profile: null });

    const { world, isAdmin } = mapDbRole(prof.role);
    const entity = prof.restaurant_id ? (RESTAURANT_TO_ENTITY[prof.restaurant_id] ?? null) : null;
    const body: any = {
      profile: {
        id: prof.id, name: prof.name, email: user.email ?? null, dbRole: prof.role,
        world, isAdmin, restaurantId: prof.restaurant_id, entity, color: prof.color,
      },
    };
    if (wantDbg) body.dbg = { user_id: user.id, prof_row_present: true };
    return NextResponse.json(body);
  } catch (e: any) {
    return NextResponse.json({ profile: null, error: e?.message ?? "unknown" });
  }
}
