import { notFound } from "next/navigation";
import Link from "next/link";
import FabHidden from "@/components/FabHidden";
import { supabase } from "@/lib/supabase";
import { getGuestBrand } from "@/lib/guest/brand";
import { buildTimeSlots } from "@/lib/guest/booking";
import BookForm from "./BookForm";

export const dynamic = "force-dynamic";

export default async function BookPage({ params }: { params: { slug: string } }) {
  const { data: r } = await supabase
    .from("restaurants").select("id,name,public_slug").eq("public_slug", params.slug).maybeSingle();
  if (!r) notFound();
  const brand = getGuestBrand(params.slug, r.name || undefined);

  const slots = buildTimeSlots(); // TODO: pull from restaurants.working_hours once wired

  return (
    <main className="min-h-screen" style={{ background: brand.bg, color: brand.ink, ["--accent" as any]: brand.accent } as any}>
      <FabHidden />
      <div className="mx-auto max-w-lg px-8 pt-12 pb-16">
        <Link href={`/m/${params.slug}`} className="font-mono text-[11px] uppercase tracking-[0.2em]" style={{ color: brand.clay }}>
          ‹ back to menu
        </Link>
        <p className="mt-6 font-mono text-[10px] uppercase tracking-[0.28em]" style={{ color: brand.accent }}>Book a table</p>
        <h1 className={`mt-3 text-[36px] leading-[1.05] ${brand.wordmarkClass}`} style={{ color: brand.ink }}>
          {r.name || brand.restaurantName}
        </h1>
        <p className="mt-4 font-serif italic text-[16px]" style={{ color: brand.inkSoft }}>
          Tell us who's coming and when — we'll take it from there.
        </p>

        <BookForm slug={params.slug} restaurantId={r.id} venueName={r.name || brand.restaurantName} slots={slots} brand={brand} />
      </div>
    </main>
  );
}
