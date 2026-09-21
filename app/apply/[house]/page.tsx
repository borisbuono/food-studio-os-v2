import { notFound } from "next/navigation";
import { APPLY_CONTACT, applyClient, type ApplyPageInfo } from "@/lib/hiring-apply";
import ApplyForm from "./ApplyForm";

export const dynamic = "force-dynamic";

// /apply/<slug> — public job application. The link that goes in an
// Instagram bio / story / WhatsApp group. No account needed.
export async function generateMetadata({ params }: { params: { house: string } }) {
  const name = params.house === "taller" ? "Taller Sa Penya" : params.house === "bm" ? "Bistro Mondo" : "Food Studio";
  return { title: `Trabaja con nosotros — ${name}`, description: `Cocina en ${name}, Ibiza. Manda tu CV en dos minutos.` };
}

export default async function ApplyPage({
  params,
  searchParams,
}: {
  params: { house: string };
  searchParams: { src?: string; utm_source?: string; utm_campaign?: string; role?: string; lang?: string; area?: string; kind?: string };
}) {
  const { data } = await applyClient().rpc("apply_page_info", { p_slug: params.house });
  const ent = data as ApplyPageInfo | null;
  if (!ent?.id) notFound();
  const openings = ent.openings || [];

  const source = (searchParams.src || searchParams.utm_source || "apply_page").slice(0, 40).toLowerCase();
  return (
    <ApplyForm
      slug={params.house}
      houseName={ent.name}
      legalName={ent.legal_name || ent.name}
      accent={ent.accent || "#111111"}
      contact={APPLY_CONTACT[params.house] || "info@ibzfoodstudio.com"}
      openings={openings.map((o) => ({ id: o.id, title: o.title, station: o.station, hours_per_week: null }))}
      preselect={searchParams.role || ""}
      initialLang={searchParams.lang === "en" ? "en" : "es"}
      initialArea={searchParams.area || ""}
      initialKind={searchParams.kind || ""}
      source={source}
      utm={searchParams.utm_campaign || ""}
    />
  );
}
