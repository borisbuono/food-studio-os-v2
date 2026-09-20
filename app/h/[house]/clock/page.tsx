import { redirect } from "next/navigation";
import { entityForHouseSlug, houseNameForSlug } from "@/lib/houses";
import { supabaseServer } from "@/lib/supabaseServer";
import ClockKiosk from "./ClockKiosk";

export const dynamic = "force-dynamic";

// /h/<slug>/clock — full-screen kiosk. Everyone who is a member of this
// entity shows up as a tile. Tap → clock in. Tap-again → break modal +
// clock out. No PIN in v1 — trust the team.

export default async function ClockPage({ params }: { params: { house: string } }) {
  const slug = params.house;
  const entity_id = entityForHouseSlug(slug);
  if (!entity_id) redirect("/studio");

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user?.id) redirect(`/login?next=/h/${slug}/clock`);

  // Roster = every team_member that has an active membership on this entity
  // AND an auth_user_id (they've signed in at least once). Kiosk mode is
  // for the operational team, not stale invites.
  const { data: mRows } = await sb
    .from("memberships")
    .select("person_id, role")
    .eq("entity_id", entity_id)
    .eq("status", "active");
  const personIds = Array.from(new Set((mRows || []).map((r: any) => r.person_id as string)));
  const roleByPerson = new Map<string, string | null>();
  for (const r of mRows || []) roleByPerson.set(r.person_id as string, (r as any).role || null);

  let roster: Array<{ auth_user_id: string; name: string | null; email: string | null; role: string | null }> = [];
  if (personIds.length) {
    const { data: members } = await sb
      .from("team_members")
      .select("id, auth_user_id, name, email, default_role, status")
      .in("id", personIds);
    roster = (members || [])
      .filter((m: any) => m.auth_user_id && m.status !== "archived")
      .map((m: any) => ({
        auth_user_id: m.auth_user_id as string,
        name: (m.name as string | null) || null,
        email: (m.email as string | null) || null,
        role: (roleByPerson.get(m.id as string) as string | null) || (m.default_role as string | null) || null,
      }))
      .sort((a, b) => (a.name || a.email || "").localeCompare(b.name || b.email || ""));
  }

  return (
    <ClockKiosk
      entity_id={entity_id}
      roster={roster}
      houseName={houseNameForSlug(slug)}
      houseSlug={slug}
    />
  );
}
