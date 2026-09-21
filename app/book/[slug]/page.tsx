import { notFound } from "next/navigation";
import { applyClient } from "@/lib/hiring-apply";
import type { BookingInfo } from "@/lib/calendarBooking";
import BookingPicker from "./BookingPicker";

export const dynamic = "force-dynamic";

// /book/<slug> — public "book time with …" page (Cal.com model). No account.
// ?intent=interview&candidate=<id>&k=<token> turns it into an interview link.
export async function generateMetadata({ params }: { params: { slug: string } }) {
  const { data } = await applyClient().rpc("booking_page_info", { p_slug: params.slug });
  const i = data as BookingInfo | null;
  return { title: i ? `${i.name} · ${i.venue}` : "Book", robots: { index: false } };
}

export default async function BookPage({ params, searchParams }: {
  params: { slug: string };
  searchParams: { intent?: string; candidate?: string; k?: string; lang?: string };
}) {
  const { data } = await applyClient().rpc("booking_page_info", { p_slug: params.slug });
  const info = data as BookingInfo | null;
  if (!info) notFound();
  const intent = searchParams.intent === "interview" ? "interview" : "meeting";
  return (
    <BookingPicker
      slug={params.slug}
      info={info}
      intent={intent}
      candidate={searchParams.candidate || null}
      token={searchParams.k || null}
      lang={searchParams.lang === "en" ? "en" : "es"}
    />
  );
}
