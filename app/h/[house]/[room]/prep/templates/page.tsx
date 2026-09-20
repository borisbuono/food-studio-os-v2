import { redirect } from "next/navigation";
import { getHouseBySlug, houseNameForSlug } from "@/lib/houses";
import PrepTemplates from "@/components/PrepTemplates";

export const dynamic = "force-dynamic";

export default async function KitchenPrepTemplatesPage({ params }: { params: { house: string; room: string } }) {
  const house = await getHouseBySlug(params.house);
  if (!house) redirect("/studio");
  if (params.room !== "kitchen") redirect(`/h/${params.house}`);
  return <PrepTemplates entityId={house.id} houseSlug={params.house} />;
}

export function generateMetadata({ params }: { params: { house: string; room: string } }) {
  return { title: `${houseNameForSlug(params.house)} · Kitchen · Prep templates · Food Studios` };
}
