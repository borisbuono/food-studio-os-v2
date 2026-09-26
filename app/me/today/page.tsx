import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabaseServer";
import { loadEvents, myEntities } from "@/lib/calendar.server";
import { addDaysYmd, zonedParts, zonedToUtc } from "@/lib/calendar";
import TodayAgenda, { type TodayTodo } from "@/components/calendar/TodayAgenda";
import Calendar from "./Calendar";
import TabNav, { pickTab } from "@/components/nav/TabNav";

const TABS = [{ key: "today", label: "Today" }, { key: "calendar", label: "My week" }];

export const dynamic = "force-dynamic";

// /me/today — Amie-model daily agenda: today's events and today's todos in
// one column. Events are chronological; todos are yours to reorder.
// Slim OS slice 4 (audit #19): /me/calendar folded in as ?tab=calendar.
export default async function TodayPage({ searchParams }: { searchParams?: { tab?: string } }) {
  const tab = pickTab(TABS, searchParams?.tab);
  const tabs = <TabNav base="/me/today" tabs={TABS} active={tab} />;
  if (tab === "calendar") return <div><div className="mx-auto max-w-7xl px-4 pt-6 sm:px-6">{tabs}</div><Calendar /></div>;
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
      <div className="mb-4">{tabs}</div>
      <TodayAgenda tz={tz} todayYmd={today} events={events} todos={todos} entityNames={mine.names} />
    </main>
  );
}
