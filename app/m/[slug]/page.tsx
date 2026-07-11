import { notFound } from "next/navigation";
import Link from "next/link";
import { cookies } from "next/headers";
import FabHidden from "@/components/FabHidden";
import { supabase } from "@/lib/supabase";
import { getGuestBrand } from "@/lib/guest/brand";
import { copy, type GuestLang } from "@/lib/guest/allergens";
import { noEmoji } from "@/lib/text";
import GuestMenuBoard from "./GuestMenuBoard";

export const dynamic = "force-dynamic";

const LANGS: GuestLang[] = ["en", "es", "de"];
function readLang(): GuestLang {
  const c = cookies().get("fs_guest_lang")?.value as GuestLang | undefined;
  return c && LANGS.includes(c) ? c : "en";
}

type MItem = {
  id: string; name: string; name_es: string | null; name_de: string | null;
  section: string | null; price: number | null; description: string | null;
  description_es: string | null; description_de: string | null;
  is_special: boolean | null; is_eighty_six: boolean | null;
  category: string | null; course: string | null; wine_style: string | null;
  allergens: string[] | null; dietary: string[] | null;
};
type Commercial = { id: string; type: string; title: string; description: string | null; starts_at: string | null; ends_at: string | null; active: boolean };

export default async function PublicVenueMenu({ params }: { params: { slug: string } }) {
  const lang = readLang();

  // Resolve slug → restaurant.
  const { data: r } = await supabase
    .from("restaurants")
    .select("id,name,public_slug")
    .eq("public_slug", params.slug)
    .maybeSingle();
  if (!r) notFound();

  const brand = getGuestBrand(params.slug, r.name || undefined);

  // Published items + active commercials for this venue.
  const [itemsRes, comRes] = await Promise.all([
    supabase.from("menu_items")
      .select("id,name,name_es,name_de,section,price,description,description_es,description_de,is_special,is_eighty_six,category,course,wine_style,allergens,dietary")
      .eq("restaurant_id", r.id)
      .eq("published_to_m", true)
      .order("section")
      .order("name"),
    supabase.from("commercials")
      .select("id,type,title,description,starts_at,ends_at,active")
      .eq("restaurant_id", r.id)
      .eq("active", true),
  ]);
  const rawItems = ((itemsRes.data || []) as MItem[]).filter((i) => !i.is_eighty_six);
  const commercials = (comRes.data || []) as Commercial[];

  // Choose translated name/description client-side; server sends raw + translated.
  const items = rawItems.map((it) => ({
    ...it,
    name: noEmoji(it.name),
    name_es: it.name_es ? noEmoji(it.name_es) : null,
    name_de: it.name_de ? noEmoji(it.name_de) : null,
    allergens: (it.allergens || []) as string[],
    dietary: (it.dietary || []) as string[],
  }));

  // Which language toggles to show — only offer ES/DE when the venue has any
  // translated field (avoids offering languages with no content behind them).
  const hasES = items.some((i) => i.name_es || i.description_es);
  const hasDE = items.some((i) => i.name_de || i.description_de);
  const langsAvailable: GuestLang[] = ["en", ...(hasES ? ["es" as GuestLang] : []), ...(hasDE ? ["de" as GuestLang] : [])];

  const specials = items.filter((i) => i.is_special || (i.section || "").toLowerCase() === "specials");
  const food = items.filter((i) => i.category === "food" && !(i.is_special || (i.section || "").toLowerCase() === "specials"));
  const wine = items.filter((i) => i.category === "drink" && (i.section === "wine" || i.wine_style));
  const bar = items.filter((i) => i.category === "drink" && !(i.section === "wine" || i.wine_style));
  const empty = items.length === 0;

  return (
    <main
      className="min-h-screen"
      style={{ background: brand.bg, color: brand.ink, ["--accent" as any]: brand.accent } as any}
    >
      <FabHidden />

      {/* Masthead — full brand, no OS chrome */}
      <header className="mx-auto max-w-lg px-8 pt-14 pb-4 text-center">
        <p className="font-mono text-[10px] uppercase tracking-[0.32em]" style={{ color: brand.clay }}>{brand.kicker}</p>
        <h1 className={`mt-3 text-[44px] leading-[1.02] ${brand.wordmarkClass}`} style={{ color: brand.ink }}>
          {r.name || brand.restaurantName}
        </h1>
        <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.28em]" style={{ color: brand.accent }}>
          {copy("m.menu", lang)}
        </p>
      </header>

      <GuestMenuBoard
        lang={lang}
        langsAvailable={langsAvailable}
        brand={brand}
        commercials={commercials}
        specials={specials}
        food={food}
        wine={wine}
        bar={bar}
        empty={empty}
      />

      {/* Booking CTA + private-event opt-in */}
      <section className="mx-auto max-w-lg px-8 pt-12 pb-16 text-center">
        <Link
          href={`/m/${params.slug}/book`}
          className="inline-block rounded-full px-8 py-3 font-sans text-[13px] font-medium tracking-wide"
          style={{ background: brand.accent, color: "#FBF7EF" }}
        >
          {copy("m.book.cta", lang)}
        </Link>
        <div className="mt-8">
          <Link
            href={`/m/${params.slug}/private`}
            className="font-serif italic text-[16px] underline decoration-1 underline-offset-4"
            style={{ color: brand.inkSoft }}
          >
            {copy("m.private.cta", lang)}
          </Link>
        </div>
        <p className="mt-14 font-mono text-[9.5px] uppercase tracking-[0.25em]" style={{ color: brand.clay }}>
          {brand.supportLine}
        </p>
      </section>
    </main>
  );
}
