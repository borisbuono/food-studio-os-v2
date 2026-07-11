import { notFound } from "next/navigation";
import Link from "next/link";
import FabHidden from "@/components/FabHidden";
import { guestServiceClient } from "@/lib/guest/serviceClient";
import { verifyGuestToken } from "@/lib/guest/token";
import { getGuestBrand } from "@/lib/guest/brand";
import FeedbackForm from "./FeedbackForm";

export const dynamic = "force-dynamic";

export default async function ThanksPage({ params, searchParams }: { params: { slug: string }; searchParams: { token?: string } }) {
  const sb = guestServiceClient;
  const { data: r } = await sb.from("restaurants").select("id,name,public_slug").eq("public_slug", params.slug).maybeSingle();
  if (!r) notFound();
  const brand = getGuestBrand(params.slug, r.name || undefined);

  const token = String(searchParams?.token || "");
  const payload = verifyGuestToken(token);
  // /thanks accepts both preferences + thanks tokens — the same booking can hit
  // either flow with the same signed link (kind is 'preferences' by default).
  const validToken = payload && (payload.k === "thanks" || payload.k === "preferences");

  if (!validToken) {
    return (
      <main className="min-h-screen" style={{ background: brand.bg, color: brand.ink } as any}>
        <FabHidden />
        <div className="mx-auto max-w-lg px-8 pt-16">
          <p className="font-mono text-[10px] uppercase tracking-[0.28em]" style={{ color: brand.accent }}>Link expired</p>
          <h1 className={`mt-3 text-[32px] ${brand.wordmarkClass}`} style={{ color: brand.ink }}>This feedback link isn't valid.</h1>
          <Link href={`/m/${params.slug}`} className="mt-8 inline-block font-mono text-[11px] uppercase tracking-[0.2em] underline underline-offset-4" style={{ color: brand.accent }}>
            Back to the menu
          </Link>
        </div>
      </main>
    );
  }

  const { data: guest } = await sb.from("guests").select("id,name,email").eq("id", payload!.g).maybeSingle();

  return (
    <main className="min-h-screen" style={{ background: brand.bg, color: brand.ink, ["--accent" as any]: brand.accent } as any}>
      <FabHidden />
      <div className="mx-auto max-w-lg px-8 pt-12 pb-16">
        <p className="font-mono text-[10px] uppercase tracking-[0.28em]" style={{ color: brand.accent }}>Thank you</p>
        <h1 className={`mt-3 text-[36px] leading-[1.05] ${brand.wordmarkClass}`} style={{ color: brand.ink }}>
          How was your visit{guest?.name ? `, ${(guest.name).split(" ")[0]}` : ""}?
        </h1>
        <p className="mt-4 font-serif italic text-[16px] leading-relaxed" style={{ color: brand.inkSoft }}>
          A minute of your time helps us look after you — and the next guest — better.
        </p>

        <FeedbackForm
          slug={params.slug}
          token={token}
          guestEmail={guest?.email || null}
          brand={brand}
        />
      </div>
    </main>
  );
}
