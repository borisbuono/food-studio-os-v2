import { supabaseServer } from "@/lib/supabaseServer";
export const runtime = "nodejs";
export async function GET(req: Request) {
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user?.id) return Response.json({ ok: false, integrations: [] }, { status: 401 });
  const url = new URL(req.url);
  const entity = url.searchParams.get("entity");
  let q = sb.from("entity_integrations").select("id,entity_code,platform,integration_type,display_name,status,last_check_at,last_error,rotated_at,added_by").is("revoked_at", null).order("rotated_at", { ascending: false, nullsFirst: false });
  if (entity) q = q.eq("entity_code", entity);
  const { data, error } = await q;
  return Response.json({ ok: !error, integrations: data || [], error: error?.message });
}
