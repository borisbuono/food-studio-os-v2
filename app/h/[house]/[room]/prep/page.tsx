import { redirect } from "next/navigation";
import { entityForHouseSlug, houseNameForSlug } from "@/lib/houses";
import PrepList from "@/components/PrepList";

// /h/<slug>/kitchen/prep — full-screen prep list for a house's kitchen.
// Full-screen (no AppChrome / sidebar) because the phone view for the
// kitchen team should be everything-tap-target, nothing else.
//
// service_date is derived server-side ONCE from the venue's local day
// (Madrid) so multiple consumers can't disagree on which day the app is
// on — see derived_date_computed_once memory. If the user needs to prep
// tomorrow they use the templates page + generator, not URL surgery.

export const dynamic = "force-dynamic";

function madridTodayISO(): string {
  // Locale-formatted YYYY-MM-DD in Europe/Madrid; matches the trading-day
  // convention used across finance/POS pulls.
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Madrid" });
}

export default function KitchenPrepPage({ params }: { params: { house: string; room: string } }) {
  const entity = entityForHouseSlug(params.house);
  if (!entity) redirect("/studio");
  if (params.room !== "kitchen") redirect(`/h/${params.house}`);
  const date = madridTodayISO();
  return <PrepList entityId={entity} serviceDate={date} houseSlug={params.house} />;
}

export function generateMetadata({ params }: { params: { house: string; room: string } }) {
  return { title: `${houseNameForSlug(params.house)} · Kitchen · Prep · Food Studios` };
}
