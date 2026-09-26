import { redirect } from "next/navigation";
import { houseNameForSlug } from "@/lib/houses";
import { getHouseBySlug } from "@/lib/houses.server";
import { supabaseServer } from "@/lib/supabaseServer";
import TabNav, { pickTab } from "@/components/nav/TabNav";
import Inbox from "./Inbox";
import Saved from "./Saved";
import Reviews from "@/components/merged/comms/Reviews";
import PostingCalendar from "@/app/grow/reach/calendar/page";
import { verbWord } from "@/lib/nav/labels";
import { serverLang } from "@/lib/i18nServer";

// /h/<slug>/comms — ONE Comms screen per house (slim OS slice 4, critic
// slice "Reach"; Boris: reviews move Serve → Reach).
//   Inbox     comments + DMs, one tap sends   (was /h/<slug>/office/inbox)
//   Reviews   what people wrote about us       (was /grow/reputation)
//   Calendar  social_posts for THIS house      (the posting calendar, house-scoped)
//   Saved     canned replies                   (was /h/<slug>/office/inbox/saved)
// House-scoped by URL: a BM and a Taller comment never share a list. The
// send gate is unchanged — approve still runs through meta-reply's
// approved_by_boris; this screen adds no send path. The waiting count comes
// from the same reader as the chip and the rail (social_inbox_waiting).
export const dynamic = "force-dynamic";

const TABS = [
  { key: "inbox", label: "Inbox" },
  { key: "reviews", label: "Reviews" },
  { key: "calendar", label: "Calendar" },
  { key: "saved", label: "Saved replies" },
];

export default async function CommsPage({ params, searchParams }: { params: { house: string }; searchParams?: { tab?: string } }) {
  const house = await getHouseBySlug(params.house);
  if (!house) redirect("/studio");
  const tab = pickTab(TABS, searchParams?.tab);
  const base = `/h/${params.house}/comms`;
  let waiting: number | null = null;
  try {
    const { data } = await supabaseServer().from("social_inbox_waiting").select("waiting").eq("entity_id", house.id).maybeSingle();
    waiting = (data as { waiting?: number } | null)?.waiting ?? null;
  } catch { waiting = null; }
  const tabs = TABS.map((t) => (t.key === "inbox" ? { ...t, count: waiting } : t));
  return (
    <div>
      <div className={`mx-auto ${tab === "calendar" ? "max-w-6xl" : tab === "reviews" ? "max-w-3xl lg:max-w-5xl" : "max-w-3xl"} px-3 pt-6 sm:px-6 sm:pt-8`}>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-clay">{houseNameForSlug(params.house)} · {verbWord("reach", serverLang())}</p>
        <h1 className="mt-1 font-serif text-3xl text-ink">{TABS.find((t) => t.key === tab)?.label}</h1>
        <TabNav base={base} tabs={tabs} active={tab} className="mt-5" />
      </div>
      <div className="[&>main]:pt-4">
        {tab === "reviews" ? <Reviews />
          : tab === "calendar" ? <PostingCalendar house={params.house} embedded />
          : tab === "saved" ? <Saved params={{ house: params.house }} />
          : <Inbox params={{ house: params.house }} />}
      </div>
    </div>
  );
}

export function generateMetadata({ params }: { params: { house: string } }) {
  return { title: `${houseNameForSlug(params.house)} · Comms · Food Studios` };
}
