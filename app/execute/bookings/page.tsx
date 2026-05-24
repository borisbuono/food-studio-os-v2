import Link from "next/link";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function Bookings() {
  const covers = (await supabase.from("covers").select("*").limit(50)).data || [];
  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/execute/today" className="font-sans text-sm text-ink-soft">← today</Link>
      <p className="mt-6 font-sans text-xs font-medium text-basil">Bookings · the book</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">Reservations</h1>
      {covers.length ? (
        <ul className="mt-6 divide-y divide-black/10 border-t border-black/10">
          {covers.map((c: any, i: number) => (
            <li key={i} className="py-3 font-sans text-[15px] text-ink">{c.guest_name || c.name || "Guest"} · {c.party_size || c.covers || ""} {c.service_time || c.time || ""}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-6 font-sans text-[15px] leading-relaxed text-ink-soft">No bookings loaded yet. Reservations — covers, times, party size and special diets — land here once the booking system is connected.</p>
      )}
    </main>
  );
}
