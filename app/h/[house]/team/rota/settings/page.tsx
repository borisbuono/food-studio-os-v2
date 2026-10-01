import Link from "next/link";
import { redirect } from "next/navigation";
import { houseNameForSlug } from "@/lib/houses";
import { getHouseBySlug } from "@/lib/houses.server";
import RotaSettings from "@/components/merged/team/RotaSettings";

// /h/<slug>/team/rota/settings — Team › Rota › Settings (rota S5, 2026-10-01).
// One page, phone first: pay rate per person, weekly budget, overtime rate,
// tolerance, staffing bands, special days. Without these the rota runs but
// understates cost and cannot propose. Every save is a manager's tick.
export const dynamic = "force-dynamic";

export default async function RotaSettingsPage({ params }: { params: { house: string } }) {
  const house = await getHouseBySlug(params.house);
  if (!house) redirect("/studio");
  const base = `/h/${params.house}/team`;
  return (
    <div>
      <div className="mx-auto max-w-xl lg:max-w-4xl px-6 pt-8">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-clay">
          {houseNameForSlug(params.house)} · <Link href={`${base}?tab=rota`} className="underline-offset-2 hover:underline">Rota</Link> · Settings
        </p>
        <h1 className="mt-1 font-serif text-3xl text-ink">Rota settings</h1>
      </div>
      <RotaSettings entityId={house.id} houseSlug={params.house} currency={house.currency_code} />
    </div>
  );
}

export function generateMetadata({ params }: { params: { house: string } }) {
  return { title: `${houseNameForSlug(params.house)} · Rota settings · Food Studios` };
}
