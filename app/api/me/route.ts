import { NextResponse } from "next/server";
import { cookies as nextCookies, headers as nextHeaders } from "next/headers";
import { supabaseServer } from "@/lib/supabaseServer";
import { RESTAURANT_TO_ENTITY } from "@/lib/entities";
import { mapDbRole } from "@/lib/roles";

export const dynamic = "force-dynamic";

export async function GET() {
  const dbg: any = {};
  try {
    // Diagnostic: what the server actually sees.
    const jar = nextCookies().getAll();
    dbg.cookies = jar.map((c) => c.name);
    dbg.host = nextHeaders().get("host") ?? null;
    const t0 = jar.find((c) => c.name === "sb-fs-auth-token");
    const c0 = jar.find((c) => c.name === "sb-fs-auth.0");
    const c1 = jar.find((c) => c.name === "sb-fs-auth.1");
    dbg.token_present = !!t0;
    dbg.chunk0_present = !!c0;
    dbg.chunk1_present = !!c1;
    dbg.token_prefix = t0?.value?.slice(0, 20) ?? null;
    dbg.chunk0_prefix = c0?.value?.slice(0, 20) ?? null;
    dbg.chunk1_prefix = c1?.value?.slice(0, 20) ?? null;
    dbg.chunk0_len = c0?.value?.length ?? 0;
    dbg.chunk1_len = c1?.value?.length ?? 0;

    const supabase = supabaseServer();
    const { data: getUserData, error: getUserErr } = await supabase.auth.getUser();
    dbg.getUser_error = getUserErr?.message ?? null;
    dbg.getUser_user_id = getUserData?.user?.id ?? null;
    dbg.getUser_email = getUserData?.user?.email ?? null;

    const { data: sessData } = await supabase.auth.getSession();
    dbg.getSession_present = !!sessData?.session;
    dbg.getSession_access_token_prefix = sessData?.session?.access_token?.slice(0, 20) ?? null;

    const user = getUserData?.user;
    if (!user) return NextResponse.json({ profile: null, dbg });

    try { await supabase.rpc("sync_my_profile_from_invite"); } catch {}

    const { data: prof } = await supabase
      .from("profiles")
      .select("id,name,role,restaurant_id,color")
      .eq("id", user.id)
      .maybeSingle();
    if (!prof) return NextResponse.json({ profile: null, dbg, prof_lookup: "no_row" });

    const { world, isAdmin } = mapDbRole(prof.role);
    const entity = prof.restaurant_id ? (RESTAURANT_TO_ENTITY[prof.restaurant_id] ?? null) : null;
    return NextResponse.json({
      profile: {
        id: prof.id, name: prof.name, email: user.email ?? null, dbRole: prof.role,
        world, isAdmin, restaurantId: prof.restaurant_id, entity, color: prof.color,
      },
      dbg,
    });
  } catch (e: any) {
    return NextResponse.json({ profile: null, error: e?.message ?? "unknown", dbg });
  }
}
