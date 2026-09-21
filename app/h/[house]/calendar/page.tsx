import { redirect } from "next/navigation";
import { getHouseBySlug } from "@/lib/houses.server";
import { supabaseServer } from "@/lib/supabaseServer";
import { loadEvents, peopleNames } from "@/lib/calendar.server";
import { addDaysYmd, mondayOf, zonedParts, zonedToUtc } from "@/lib/calendar";
import CalendarView from "@/components/calendar/CalendarView";

export const dynamic = "force-dynamic";

// /h/<slug>/calendar — the venue's merged calendar: shifts, bookings,
// interviews, tasks, social, events, prep days, HACCP services, promos.
// Times render in the venue's timezone (Utopia = Amsterdam).
export default async function SiteCalendarPage({ params }: { params: { house: string } }) {
  const slug = params.house;
  const house = await getHouseBySlug(slug);
  if (!house) redirect("/studio");
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user?.id) redirect(`/login?next=/h/${slug}/calendar`);

  const tz = house.timezone || "Europe/Madrid";
  const today = zonedParts(new Date(), tz).ymd;
  const monday = mondayOf(today);
  const events = await loadEvents({
    from: zonedToUtc(monday, 0, 0, tz).toISOString(),
    to: zonedToUtc(addDaysYmd(monday, 7), 0, 0, tz).toISOString(),
    entityId: house.id,
  }).catch(() => []);
  const people = await peopleNames(events.flatMap((e) => e.person_ids || []));
  const { data: managed } = await sb.rpc("app_my_managed_entities");
  const canRebuild = ((managed as any[]) || []).some((r: any) => (typeof r === "string" ? r : r.app_my_managed_entities) === house.id);

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <CalendarView
        kicker={`Calendar · ${house.name}`}
        title="This week"
        tz={tz}
        todayYmd={today}
        initialEvents={events}
        initialPeople={people}
        scope={{ entityId: house.id }}
        entitySlugs={{ [house.id]: slug }}
        canRebuild={canRebuild}
      />
    </main>
  );
}
