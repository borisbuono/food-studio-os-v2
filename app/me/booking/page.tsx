import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabaseServer";
import { myEntities, myPersonIds } from "@/lib/calendar.server";
import BookingSettings from "./BookingSettings";

export const dynamic = "force-dynamic";

// /me/booking — set up my public "book time with me" page (/book/<slug>).
export default async function MyBookingPage() {
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user?.id) redirect("/login?next=/me/booking");
  const [ids, mine] = await Promise.all([myPersonIds(), myEntities()]);
  const { data: profile } = ids.length
    ? await sb.from("booking_profiles").select("*").in("person_id", ids).limit(1).maybeSingle()
    : { data: null };
  const { data: me } = ids.length ? await sb.from("team_members").select("name").eq("id", ids[0]).maybeSingle() : { data: null };
  const venues = Object.entries(mine.slugs).map(([id, slug]) => ({ id, slug, name: mine.names[id] || slug }));
  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <BookingSettings initial={profile as any} venues={venues} myName={(me as any)?.name || ""} hasPerson={ids.length > 0} />
    </main>
  );
}
