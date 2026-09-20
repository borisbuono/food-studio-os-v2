import { redirect } from "next/navigation";
import { houseNameForSlug } from "@/lib/houses";
import { getHouseBySlug } from "@/lib/houses.server";
import PrepList from "@/components/PrepList";

// /h/<slug>/kitchen/prep — full-screen prep list for a house's kitchen.
// Full-screen (no AppChrome / sidebar) because the phone view for the
// kitchen team should be everything-tap-target, nothing else.
//
// service_date is derived server-side ONCE from the VENUE's local day
// (from entities.timezone — Madrid for Ibiza houses, Amsterdam for the
// Amsterdam venue) so multiple consumers can't disagree on which day the
// app is on — see derived_date_computed_once memory. P0 fix 2026-09-20
// (rehearsal punchlist): this used to hardcode "Europe/Madrid", which
// put Amsterdam's prep list on the wrong day for an hour of every night.

export const dynamic = "force-dynamic";

function tzTodayISO(tz: string): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: tz });
}

export default async function KitchenPrepPage({ params }: { params: { house: string; room: string } }) {
  const house = await getHouseBySlug(params.house);
  if (!house) redirect("/studio");
  if (params.room !== "kitchen") redirect(`/h/${params.house}`);
  const date = tzTodayISO(house.timezone);
  return <PrepList entityId={house.id} serviceDate={date} houseSlug={params.house} />;
}

export function generateMetadata({ params }: { params: { house: string; room: string } }) {
  return { title: `${houseNameForSlug(params.house)} · Kitchen · Prep · Food Studios` };
}
