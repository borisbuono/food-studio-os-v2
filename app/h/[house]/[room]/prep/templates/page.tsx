import { redirect } from "next/navigation";
import { entityForHouseSlug, houseNameForSlug } from "@/lib/houses";
import PrepTemplates from "@/components/PrepTemplates";

export const dynamic = "force-dynamic";

export default function KitchenPrepTemplatesPage({ params }: { params: { house: string; room: string } }) {
  const entity = entityForHouseSlug(params.house);
  if (!entity) redirect("/studio");
  if (params.room !== "kitchen") redirect(`/h/${params.house}`);
  return <PrepTemplates entityId={entity} houseSlug={params.house} />;
}

export function generateMetadata({ params }: { params: { house: string; room: string } }) {
  return { title: `${houseNameForSlug(params.house)} · Kitchen · Prep templates · Food Studios` };
}
