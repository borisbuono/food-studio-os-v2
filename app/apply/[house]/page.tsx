import { notFound } from "next/navigation";
import { APPLY_CONTACT, applyClient, type ApplyPageInfo } from "@/lib/hiring-apply";
import ApplyForm from "./ApplyForm";

export const dynamic = "force-dynamic";

// /apply/<slug> — public job application. The link that goes in an
// Instagram bio / story / WhatsApp group. No account needed.
//
// Embedded on bistro-mondo.com/careers and ibzfoodstudio.com/careers via an
// iframe with ?embed=1. The page reads the venue's brand_kit and themes
// itself (accent / ground / heading + body font) so it stops looking like a
// stranger inside the host site.
export async function generateMetadata({ params }: { params: { house: string } }) {
  const name = params.house === "taller" ? "Taller Sa Penya" : params.house === "bm" ? "Bistro Mondo" : "Food Studio";
  return { title: `Trabaja con nosotros — ${name}`, description: `Cocina en ${name}, Ibiza. Manda tu CV en dos minutos.` };
}

// Turn a brand_kits typography family into a Google Fonts URL fragment.
// `Baloo 2` → `Baloo+2:wght@400;600;700`. Weights are baked in so headings
// have something with body and the form UI has a normal weight to fall back
// on. Returns null for anything without a Google source.
function googleFontFragment(family: string | null | undefined, weights: number[]): string | null {
  if (!family) return null;
  return `${family.replace(/\s+/g, "+")}:wght@${weights.join(";")}`;
}

export default async function ApplyPage({
  params,
  searchParams,
}: {
  params: { house: string };
  searchParams: { src?: string; utm_source?: string; utm_campaign?: string; role?: string; lang?: string; area?: string; kind?: string; embed?: string };
}) {
  const { data } = await applyClient().rpc("apply_page_info", { p_slug: params.house });
  const ent = data as ApplyPageInfo | null;
  if (!ent?.id) notFound();
  const openings = ent.openings || [];

  const source = (searchParams.src || searchParams.utm_source || "apply_page").slice(0, 40).toLowerCase();
  const embed = searchParams.embed === "1";

  const displayFamily = ent.brand_kit?.typography?.display?.family || null;
  const bodyFamily = ent.brand_kit?.typography?.body?.family || null;
  const parts = [
    googleFontFragment(displayFamily, [400, 600, 700]),
    googleFontFragment(bodyFamily, [400, 500, 600]),
  ].filter(Boolean) as string[];
  // dedupe (BM's body / display share no family, but a future kit could)
  const uniq = Array.from(new Set(parts));
  const fontHref = uniq.length
    ? `https://fonts.googleapis.com/css2?${uniq.map((p) => `family=${p}`).join("&")}&display=swap`
    : null;

  return (
    <>
      {/* Next 14 hoists these into <head>; keeps the venue font on first paint
          instead of flashing the default sans. */}
      {fontHref ? (
        <>
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
          <link rel="stylesheet" href={fontHref} />
        </>
      ) : null}
      <ApplyForm
        slug={params.house}
        houseName={ent.name}
        legalName={ent.legal_name || ent.name}
        accent={ent.accent || "#111111"}
        contact={APPLY_CONTACT[params.house] || "hola@ibzfoodstudio.com"}
        taxId={ent.tax_id}
        addressLine1={ent.address_line1}
        city={ent.city}
        postalCode={ent.postal_code}
        country={ent.country}
        brandKit={ent.brand_kit}
        openings={openings.map((o) => ({ id: o.id, title: o.title, station: o.station, hours_per_week: null }))}
        preselect={searchParams.role || ""}
        initialLang={searchParams.lang === "en" ? "en" : "es"}
        initialArea={searchParams.area || ""}
        initialKind={searchParams.kind || ""}
        source={source}
        utm={searchParams.utm_campaign || ""}
        embed={embed}
      />
    </>
  );
}
