import { redirect } from "next/navigation";
import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";
import { loadEvents, myEntities, peopleNames } from "@/lib/calendar.server";
import { addDaysYmd, mondayOf, zonedParts, zonedToUtc } from "@/lib/calendar";
import CalendarView from "@/components/calendar/CalendarView";
import GoogleConnect from "@/components/calendar/GoogleConnect";

export const dynamic = "force-dynamic";

// /me/calendar — everything with MY name on it, across venues: my shifts,
// interviews I lead, tasks assigned to me, my meetings, plus my Google
// calendar as dimmed busy blocks (read-only overlay).
// Folded into /me/today?tab=calendar (slim OS slice 4, audit #19).
export default async function MyCalendarPage() {
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user?.id) redirect("/login?next=/me/today?tab=calendar");
  const mine = await myEntities();
  const tz = mine.tz;
  const today = zonedParts(new Date(), tz).ymd;
  const monday = mondayOf(today);
  const events = await loadEvents({
    from: zonedToUtc(monday, 0, 0, tz).toISOString(),
    to: zonedToUtc(addDaysYmd(monday, 7), 0, 0, tz).toISOString(),
    mine: true, includeExternal: true,
  }).catch(() => []);
  const people = await peopleNames(events.flatMap((e) => e.person_ids || []));
  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <CalendarView
        kicker="My calendar"
        title="My week"
        tz={tz}
        todayYmd={today}
        initialEvents={events}
        initialPeople={people}
        scope={{ mine: true, external: true }}
        entitySlugs={mine.slugs}
        entityNames={mine.names}
        extraActions={
          <>
            <Link href="/me/booking" className="rounded border border-black/15 px-2 py-1">Booking page</Link>
            <GoogleConnect />
          </>
        }
      />
    </main>
  );
}
