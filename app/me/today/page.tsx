import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabaseServer";
import { loadEvents, myEntities } from "@/lib/calendar.server";
import { addDaysYmd, zonedParts, zonedToUtc } from "@/lib/calendar";
import TodayAgenda, { type TodayTodo } from "@/components/calendar/TodayAgenda";
import Calendar from "./Calendar";
import TabNav, { pickTab } from "@/components/nav/TabNav";
import Swaps from "@/components/merged/team/Swaps";
import Link from "next/link";
import { serverLang, tServer, type Lang } from "@/lib/i18nServer";

// Tab labels follow fs_lang (serverLang, 2026-10-02).
const tabsFor = (lang: Lang) => [{ key: "today", label: tServer("tab.today", lang) }, { key: "calendar", label: tServer("tab.my_week", lang) }];

export const dynamic = "force-dynamic";

// /me/today — Amie-model daily agenda: today's events and today's todos in
// one column. Events are chronological; todos are yours to reorder.
// Slim OS slice 4 (audit #19): /me/calendar folded in as ?tab=calendar.
export default async function TodayPage({ searchParams }: { searchParams?: { tab?: string } }) {
  const lang = serverLang();
  const TABS = tabsFor(lang);
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
      .not("status", "in", "(completed,deferred,noted)")
      .or(`due_at.is.null,due_at.lt.${endOfToday}`)
      .order("priority", { ascending: true })
      .limit(25),
  ]);
  const todos = ((todosRes.data || []) as TodayTodo[]);
  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <div className="mb-4">{tabs}</div>
      <TodayAgenda tz={tz} todayYmd={today} events={events} todos={todos} entityNames={mine.names} />
      {/* Clock in / out (cook path 2026-10-02): one link per house I belong to — the kiosk at /h/<slug>/clock */}
      {Object.entries(mine.slugs).length ? (
        <div className="mt-6 flex flex-wrap gap-2">
          {Object.entries(mine.slugs).map(([id, slug]) => (
            <Link key={id} href={`/h/${slug}/clock`} className="rounded-xl border border-black/15 px-4 py-2.5 font-sans text-[14px] text-ink transition hover:border-black/30" title={tServer("me.clock.hint", lang).replace("{house}", mine.names[id] || slug)}>
              {tServer("me.clock", lang)}{Object.keys(mine.slugs).length > 1 ? ` · ${mine.names[id] || slug}` : ""}
            </Link>
          ))}
        </div>
      ) : null}
      {/* rota S6: offer one of my published shifts / take a colleague's — the manager ticks */}
      <Swaps view="me" />
    </main>
  );
}
