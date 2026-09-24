import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabaseServer";
import { getHouseBySlug } from "@/lib/houses.server";
import PassScreen from "./PassScreen";

export const dynamic = "force-dynamic";

// /h/<slug>/pass — the wall screen at the pass (Chef v3 Phase 2 S5).
//
// An iPad or TV on the wall of the kitchen, read from 3 m: house name, the
// clock, the four "now" numbers, and Chef's control at the bottom scaled for
// the room. No sidebar, no top bar (AppChrome → isChromelessRoute), but the
// user MUST be signed in — Chef reads and writes as them, and the numbers
// are the house's book. Signed-out visitors bounce to /login, same as
// /capture.
export default async function PassPage({ params }: { params: { house: string } }) {
  const slug = params.house;
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user?.id) redirect("/login?next=" + encodeURIComponent(`/h/${slug}/pass`));

  const house = await getHouseBySlug(slug);
  if (!house) redirect("/studio");

  return (
    <PassScreen
      house={slug}
      entityId={house.id}
      entityName={house.name}
      tz={house.timezone || "Europe/Madrid"}
    />
  );
}
