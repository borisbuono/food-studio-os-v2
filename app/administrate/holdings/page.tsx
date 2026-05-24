import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { noEmoji } from "@/lib/text";

export const dynamic = "force-dynamic";

export default async function HoldingsMap() {
  const entities = (await supabase.from("entities").select("id,name,entity_type,legal_form,city,country,parent_entity_id,is_active").order("name")).data || [];
  const rels = (await supabase.from("entity_relationships").select("source_entity_id,target_entity_id,relationship_type")).data || [];
  const ename = new Map(entities.map((e: any) => [e.id, e.name]));
  const roots = entities.filter((e: any) => !e.parent_entity_id);
  const childrenOf = (id: string) => entities.filter((e: any) => e.parent_entity_id === id);

  const Node = ({ e, depth }: { e: any; depth: number }) => (
    <div style={{ marginLeft: depth * 16 }} className="border-l border-black/10 pl-4 py-2">
      <p className="font-serif text-[18px] text-ink">{noEmoji(e.name)}</p>
      <p className="font-mono text-[11px] uppercase tracking-wide text-clay">{[e.entity_type, e.legal_form, e.city || e.country].filter(Boolean).join(" · ")}</p>
      {childrenOf(e.id).map((c: any) => <Node key={c.id} e={c} depth={depth + 1} />)}
    </div>
  );

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/administrate" className="font-sans text-sm text-ink-soft">← administrate</Link>
      <p className="mt-6 font-sans text-xs font-medium text-ochre">Holdings · entity map</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">The structure</h1>

      <div className="mt-8">
        {roots.map((e: any) => <Node key={e.id} e={e} depth={0} />)}
        {!roots.length ? entities.map((e: any) => <Node key={e.id} e={e} depth={0} />) : null}
      </div>

      {rels.length ? (
        <section className="mt-10">
          <p className="font-sans text-xs font-medium text-clay">Relationships</p>
          <ul className="mt-2 divide-y divide-black/10">
            {rels.map((r: any, i: number) => (
              <li key={i} className="py-2 font-sans text-[14px] text-ink-soft">
                {noEmoji(ename.get(r.source_entity_id) || "?")} <span className="font-mono text-[11px] text-clay">— {r.relationship_type} →</span> {noEmoji(ename.get(r.target_entity_id) || "?")}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
