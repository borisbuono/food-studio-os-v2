import { notFound } from "next/navigation";
import Link from "next/link";
import FabHidden from "@/components/FabHidden";
import { guestServiceClient } from "@/lib/guest/serviceClient";
import { verifyGuestToken } from "@/lib/guest/token";
import { getGuestBrand } from "@/lib/guest/brand";
import PreferencesEditor from "./PreferencesEditor";

export const dynamic = "force-dynamic";

type Guest = { id: string; name: string | null; email: string | null; phone: string | null; allergies: string | null; dietary: string | null; birthday: string | null; notes: string | null };
type Booking = { id: string; service_date: string; service_time: string | null; party_size: number };

export default async function PreferencesPage({ params, searchParams }: { params: { slug: string }; searchParams: { token?: string } }) {
  const sb = guestServiceClient;
  const { data: r } = await sb.from("restaurants").select("id,name,public_slug").eq("public_slug", params.slug).maybeSingle();
  if (!r) notFound();
  const brand = getGuestBrand(params.slug, r.name || undefined);

  const token = String(searchParams?.token || "");
  const payload = verifyGuestToken(token);

  if (!payload || payload.k !== "preferences") {
    return (
      <main className="min-h-screen" style={{ background: brand.bg, color: brand.ink } as any}>
        <FabHidden />
        <div className="mx-auto max-w-lg px-8 pt-16">
          <p className="font-mono text-[10px] uppercase tracking-[0.28em]" style={{ color: brand.accent }}>Link expired</p>
          <h1 className={`mt-3 text-[32px] ${brand.wordmarkClass}`} style={{ color: brand.ink }}>This preferences link isn't valid.</h1>
          <p className="mt-4 font-serif italic text-[16px]" style={{ color: brand.inkSoft }}>
            The link may have expired or been used incorrectly. If you have an upcoming visit and need to update
            your preferences, please reply to the confirmation email or contact us directly.
          </p>
          <Link href={`/m/${params.slug}`} className="mt-8 inline-block font-mono text-[11px] uppercase tracking-[0.2em] underline underline-offset-4" style={{ color: brand.accent }}>
            Back to the menu
          </Link>
        </div>
      </main>
    );
  }

  const [{ data: guest }, { data: booking }] = await Promise.all([
    sb.from("guests").select("id,name,email,phone,allergies,dietary,birthday,notes").eq("id", payload.g).maybeSingle(),
    payload.b ? sb.from("bookings").select("id,service_date,service_time,party_size").eq("id", payload.b).maybeSingle() : Promise.resolve({ data: null as Booking | null }),
  ]);
  if (!guest) notFound();

  return (
    <main className="min-h-screen" style={{ background: brand.bg, color: brand.ink, ["--accent" as any]: brand.accent } as any}>
      <FabHidden />
      <div className="mx-auto max-w-lg px-8 pt-12 pb-16">
        <Link href={`/m/${params.slug}`} className="font-mono text-[11px] uppercase tracking-[0.2em]" style={{ color: brand.clay }}>
          ‹ back to menu
        </Link>
        <p className="mt-6 font-mono text-[10px] uppercase tracking-[0.28em]" style={{ color: brand.accent }}>Your preferences</p>
        <h1 className={`mt-3 text-[36px] leading-[1.05] ${brand.wordmarkClass}`} style={{ color: brand.ink }}>
          Hello, {(guest.name || "").split(" ")[0] || "friend"}
        </h1>

        {booking ? (
          <div className="mt-6 rounded-lg px-5 py-4" style={{ background: brand.accent + "10", border: `1px solid ${brand.accent}33` }}>
            <p className="font-mono text-[10px] uppercase tracking-[0.24em]" style={{ color: brand.accent }}>Upcoming visit</p>
            <p className="mt-1 font-serif text-[18px]" style={{ color: brand.ink }}>
              {formatDate(booking.service_date)}{booking.service_time ? ` · ${booking.service_time}` : ""} · {booking.party_size} {booking.party_size === 1 ? "guest" : "guests"}
            </p>
          </div>
        ) : null}

        <p className="mt-8 font-serif italic text-[16px] leading-relaxed" style={{ color: brand.inkSoft }}>
          Let the kitchen and floor know how to look after you. These stay on your guest record for future visits too.
        </p>

        <PreferencesEditor
          slug={params.slug}
          token={token}
          guest={guest as Guest}
          hasBooking={!!booking}
          brand={brand}
        />
      </div>
    </main>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso + "T00:00");
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}
