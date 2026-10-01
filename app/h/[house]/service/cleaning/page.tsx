import { redirect } from "next/navigation";
import { houseNameForSlug } from "@/lib/houses";
import { getHouseBySlug } from "@/lib/houses.server";
import { supabaseServer } from "@/lib/supabaseServer";
import { verbWord } from "@/lib/nav/labels";
import { serverLang, tServer } from "@/lib/i18nServer";
import { cleaningCaller } from "@/lib/cleaning/auth";
import { tzToday } from "@/lib/cleaning/server";
import CleaningToday from "@/components/cleaning/CleaningToday";
import CleaningTemplates from "@/components/cleaning/CleaningTemplates";

// /h/<slug>/service/cleaning — today's cleaning lists (APPCC record), the
// cleaning third of the old MEP fruit salad (mep_is_three_concepts_not_one).
// Lives under Service next to the prep list. ?tab=templates = the lists
// themselves (managers). service_date is the VENUE's local day, derived once.
export const dynamic = "force-dynamic";

export default async function CleaningPage({ params, searchParams }: { params: { house: string }; searchParams?: { tab?: string } }) {
  const house = await getHouseBySlug(params.house);
  if (!house) redirect("/studio");
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user?.id) redirect("/login?next=" + encodeURIComponent(`/h/${params.house}/service/cleaning`));
  const who = await cleaningCaller(house.id);
  const isManager = who.ok ? who.isManager : false;
  const lang = serverLang();
  const templates = searchParams?.tab === "templates" && isManager;
  const date = tzToday(house.timezone);
  return (
    <div>
      <div className="mx-auto max-w-xl px-4 pt-8 lg:max-w-3xl">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-clay">{houseNameForSlug(params.house)} · {verbWord("serve", lang)}</p>
        <h1 className="mt-1 font-serif text-3xl text-ink">{tServer("cleaning.title", lang)}{templates ? " · " + tServer("cleaning.templates", lang) : ""}</h1>
      </div>
      <div className="mt-4">
        {templates
          ? <CleaningTemplates entityId={house.id} houseSlug={params.house} lang={lang} />
          : <CleaningToday entityId={house.id} houseSlug={params.house} serviceDate={date} lang={lang} isManager={isManager} />}
      </div>
    </div>
  );
}

export function generateMetadata({ params }: { params: { house: string } }) {
  return { title: `${houseNameForSlug(params.house)} · Service · Cleaning · Food Studios` };
}
