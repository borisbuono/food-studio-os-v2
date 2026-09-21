import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabaseServer";
import { loadEvents, myEntities } from "@/lib/calendar.server";
import { addDaysYmd, zonedParts, zonedToUtc } from "@/lib/calendar";
import TodayAgenda, { type TodayTodo } from "@/components/calendar/TodayAgenda";

export const dynamic = "force-dynamic";

// /me/today — Amie-model daily agenda: today's events and today's todos in
// one column. Events are chronological; todos are yours to reorder.
export default async function TodayPage() {
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user?.id) redirect("/login?next=/me/today");
  const mine = await myEntities();
  const tz = mine.tz;
  const today = zonedParts(new Date(), tz).ymd;
  const endOfToday = zonedToUtc(addDaysYmd(today, 1), 0, 0, tz).toISOString();
  const [events, todosRes] = await Promise.all([
    loadEvents({
      from: zonedToUtc(today, 0, 0, tz).toISOString(), to: endOfToday, mine: true, includeExternal: true,
    }).catch(() => []),
    sb.from("master_todos")
      .select("id, title, description, status, priority, due_at, entity_code")
      .eq("assignee_user_id", u.user.id)
      .not("status", "in", "(completed,deferred)")
      .or(`due_at.is.null,due_at.lt.${endOfToday}`)
      .order("priority", { ascending: true })
      .limit(25),
  ]);
  const todos = ((todosRes.data || []) as TodayTodo[]);
  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <TodayAgenda tz={tz} todayYmd={today} events={events} todos={todos} entityNames={mine.names} />
    </main>
  );
}
