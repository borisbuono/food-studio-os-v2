import { supabaseServer } from "@/lib/supabaseServer";
import { cookies } from "next/headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const store = cookies();
  const cookieNames = store.getAll().map((c) => c.name);
  const sb = supabaseServer();
  const { data, error } = await sb.auth.getUser();
  return Response.json({
    server_sees_user: !!data.user,
    user_id: data.user?.id || null,
    user_email: data.user?.email || null,
    auth_error: error?.message || null,
    cookie_names: cookieNames,
    has_sb_fs_auth: cookieNames.some((n) => n.startsWith("sb-fs-auth")),
    node_env: process.env.NODE_ENV,
    ts: new Date().toISOString(),
  });
}
