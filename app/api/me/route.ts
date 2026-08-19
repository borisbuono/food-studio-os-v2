import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { RESTAURANT_TO_ENTITY } from "@/lib/entities";
import { mapDbRole } from "@/lib/roles";

export const dynamic = "force-dynamic";

// Server-side profile endpoint. The sidebar/topbar's client-side
// supabaseBrowser.auth.getSession() has been unreliable (@supabase/ssr
// cookie parsing quirk), but the server-side read via next/headers has
// been proven to work end-to-end. Client falls back to this route when
// its own getSession returns null.
export async function GET() {
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
    return NextResponse.json({
      profile: {
        id: prof.id,
        name: prof.name,
        email: user.email ?? null,
        dbRole: prof.role,
        world, isAdmin,
        restaurantId: prof.restaurant_id,
        entity,
        color: prof.color,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ profile: null, error: e?.message ?? "unknown" });
  }
}
