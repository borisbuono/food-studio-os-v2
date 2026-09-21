import { notFound } from "next/navigation";
import { supabaseService } from "@/lib/supabaseService";
import { APPLY_CONTACT } from "@/lib/hiring-apply";
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
  searchParams: { src?: string; utm_source?: string; utm_campaign?: string; role?: string };
}) {
  const sb = supabaseService();
  if (!sb) notFound();
  const { data: ent } = await sb
    .from("entities")
    .select("id, name, legal_name, accent_color, hiring_enabled")
    .eq("slug", params.house)
    .maybeSingle();
  if (!ent || ent.hiring_enabled === false) notFound();
  const { data: openings } = await sb
    .from("job_openings")
    .select("id, title, station, hours_per_week")
    .eq("entity_id", ent.id)
    .eq("status", "open")
    .order("created_at", { ascending: false });

  const source = (searchParams.src || searchParams.utm_source || "apply_page").slice(0, 40).toLowerCase();
  return (
    <ApplyForm
      slug={params.house}
      houseName={ent.name as string}
      legalName={(ent.legal_name as string) || (ent.name as string)}
      accent={(ent.accent_color as string) || "#111111"}
      contact={APPLY_CONTACT[params.house] || "info@ibzfoodstudio.com"}
      openings={(openings || []) as Array<{ id: string; title: string; station: string | null; hours_per_week: number | null }>}
      preselect={searchParams.role || ""}
      source={source}
      utm={searchParams.utm_campaign || ""}
    />
  );
}
