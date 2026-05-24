import Link from "next/link";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function Prep() {
  const zones: any[] = (await supabase.from("zones").select("id,name,restaurant_id,sort_order").order("sort_order")).data || [];
  const dishes: any[] = (await supabase.from("mep_dishes").select("id,zone_id,name,sort_order").eq("is_active", true).order("sort_order")).data || [];
  const comps: any[] = (await supabase.from("mep_components").select("id,mep_dish_id,name,method,per_cover,unit,sort_order").order("sort_order")).data || [];
  const rests: any[] = (await supabase.from("restaurants").select("id,name")).data || [];
  const compByDish = (did: string) => comps.filter((c: any) => c.mep_dish_id === did);
  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/execute" className="font-sans text-sm text-ink-soft">← execute</Link>
      <p className="mt-6 font-sans text-xs font-medium text-basil">Prep · mise en place</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">{dishes.length} prep dishes</h1>
      {rests.map((r: any) => {
        const rz = zones.filter((z: any) => z.restaurant_id === r.id && dishes.some((d: any) => d.zone_id === z.id));
        if (!rz.length) return null;
        return (
          <div key={r.id} className="mt-10">
            <h2 className="font-serif text-2xl text-ink">{r.name}</h2>
            {rz.map((z: any) => {
              const zd = dishes.filter((d: any) => d.zone_id === z.id);
              return (
                <section key={z.id} className="mt-6">
                  <h3 className="font-sans text-xs font-medium uppercase tracking-wide text-clay">{z.name}</h3>
                  <div className="mt-2 space-y-4">
                    {zd.map((d: any) => {
                      const cs = compByDish(d.id);
                      return (
                        <div key={d.id}>
                          <p className="font-serif text-lg text-ink">{d.name}</p>
                          {cs.length ? <ul className="mt-1 divide-y divide-black/10">{cs.map((c: any) => (
                            <li key={c.id} className="flex items-baseline justify-between gap-4 py-1.5">
                              <span className="font-sans text-[14px] text-ink-soft">{c.name}{c.method ? <span className="text-clay"> · {c.method}</span> : null}</span>
                              <span className="font-mono text-[12px] text-clay">{c.per_cover ?? ""} {c.unit ?? ""}</span>
                            </li>
                          ))}</ul> : null}
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        );
      })}
    </main>
  );
}
