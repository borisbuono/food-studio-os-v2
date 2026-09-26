import { redirect } from "next/navigation";
import { houseNameForSlug } from "@/lib/houses";
import { getHouseBySlug } from "@/lib/houses.server";
import TabNav, { pickTab } from "@/components/nav/TabNav";
import Team from "@/components/merged/team/Team";
import Rota from "@/components/merged/team/Rota";
import Labor from "./_labor/Labor";
import Invite from "@/components/merged/team/Invite";
import { verbWord } from "@/lib/nav/labels";
import { serverLang } from "@/lib/i18nServer";

// /h/<slug>/team — ONE Team landing per house (slim OS slice 4).
//   Team    who is on the team            (was /administrate/team)
//   Rota    who works when                (was /administrate/team/schedule)   } audit #11
//   Labour  clock log + labour cost       (was /h/<slug>/office/labor)         }
//   Invite  invite a teammate             (was /administrate/team/invite)
// Hiring (the Sep-21 SOP layer), clock station and academy stay as leaves.
// Middleware binds fs_entity from the slug, so the cookie-scoped Team and
// Rota components read THIS house.
export const dynamic = "force-dynamic";

const TABS = [
  { key: "team", label: "Team" },
  { key: "rota", label: "Rota" },
  { key: "labour", label: "Labour" },
  { key: "invite", label: "Invite" },
];

export default async function TeamPage({ params, searchParams }: { params: { house: string }; searchParams?: { tab?: string } }) {
  const house = await getHouseBySlug(params.house);
  if (!house) redirect("/studio");
  const tab = pickTab(TABS, searchParams?.tab);
  const base = `/h/${params.house}/team`;
  return (
    <div>
      <div className={`mx-auto ${tab === "labour" ? "max-w-5xl" : "max-w-xl lg:max-w-4xl"} px-6 pt-8`}>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-clay">{houseNameForSlug(params.house)} · {verbWord("people", serverLang())}</p>
        <h1 className="mt-1 font-serif text-3xl text-ink">{TABS.find((t) => t.key === tab)?.label}</h1>
        <TabNav base={base} tabs={TABS} active={tab} className="mt-5" />
      </div>
      <div className="[&>main]:pt-4">
        {tab === "rota" ? <Rota /> : tab === "labour" ? <Labor params={{ house: params.house }} /> : tab === "invite" ? <Invite /> : <Team />}
      </div>
    </div>
  );
}

export function generateMetadata({ params }: { params: { house: string } }) {
  return { title: `${houseNameForSlug(params.house)} · Team · Food Studios` };
}
