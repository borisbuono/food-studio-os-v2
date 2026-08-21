"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { getMyProfile } from "@/lib/profile";
import { ENTITY_TO_RESTAURANT, EntityKey } from "@/lib/entities";
import { noEmoji } from "@/lib/text";

type W = { id: string; name: string; wine_style: string | null; producer: string | null; region: string | null; vintage: string | null; pitch: string | null; tasting_notes: string | null };
const shuffle = <T,>(a: T[]) => a.map((v) => [Math.random(), v] as const).sort((x, y) => x[0] - y[0]).map(([, v]) => v);

export default function TrainWine() {
  const [wines, setWines] = useState<W[]>([]);
  const [ready, setReady] = useState(false);
  const [i, setI] = useState(0);
  const [show, setShow] = useState(false);

  useEffect(() => {
    (async () => {
      const p = await getMyProfile();
      const ent = (p && !p.isAdmin ? p.entity : ((localStorage.getItem("fs_entity") as EntityKey) || "bistro_mondo")) || "bistro_mondo";
      const rid = p?.restaurantId || ENTITY_TO_RESTAURANT[ent as EntityKey] || ENTITY_TO_RESTAURANT.bistro_mondo!;
      const { data } = await supabaseBrowser.from("menu_items").select("id,name,wine_style,producer,region,vintage,pitch,tasting_notes").eq("restaurant_id", rid).eq("section", "wine").eq("is_active", true);
      setWines(shuffle(data || [])); setReady(true);
    })();
  }, []);

  if (!ready) return <main className="mx-auto max-w-xl lg:max-w-4xl px-6 py-12"><p className="font-serif text-2xl text-ink">Pouring…</p></main>;
  if (!wines.length) return <main className="mx-auto max-w-xl lg:max-w-4xl px-6 py-12"><Link href="/develop/wine" className="font-sans text-sm text-ink-soft">← cellar</Link><p className="mt-8 font-serif text-2xl text-ink">No wines to train on yet.</p></main>;

  const w = wines[i];
  const next = () => { setShow(false); setI((n) => (n + 1) % wines.length); };
  const prev = () => { setShow(false); setI((n) => (n - 1 + wines.length) % wines.length); };

  return (
    <main className="mx-auto max-w-xl lg:max-w-4xl px-6 py-12">
      <Link href="/develop/wine" className="font-sans text-sm text-ink-soft">← cellar</Link>
      <p className="mt-6 font-sans text-xs font-medium text-tomato">Cellar · sommelier training</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">Know the list</h1>
      <p className="mt-1 font-mono text-[11px] uppercase tracking-wide text-clay">{i + 1} / {wines.length} · {(w.wine_style || "wine").replace("_", " ")}</p>

      <button onClick={() => setShow((s) => !s)} className="mt-6 w-full rounded-2xl border border-line bg-card p-8 text-left transition hover:border-tomato/40">
        <p className="font-serif text-3xl font-light text-ink">{noEmoji(w.name)}</p>
        {!show ? (
          <p className="mt-4 font-mono text-[11px] uppercase tracking-wide text-clay">Tap to reveal — can you place it &amp; pitch it?</p>
        ) : (
          <div className="mt-4 space-y-3">
            <p className="font-mono text-[12px] text-clay">{[w.producer, w.region, w.vintage].filter(Boolean).join(" · ") || "—"}</p>
            {w.pitch ? <p className="font-serif text-[17px] font-light italic leading-relaxed text-ink-soft">“{w.pitch}”</p> : null}
            {w.tasting_notes ? <p className="font-serif text-[15px] leading-relaxed text-ink-soft">{w.tasting_notes}</p> : null}
          </div>
        )}
      </button>

      <div className="mt-6 flex items-center justify-between">
        <button onClick={prev} className="font-sans text-[14px] text-ink-soft">← back</button>
        <Link href={"/develop/wine/" + w.id} className="font-mono text-[11px] uppercase tracking-wide text-tomato">full card →</Link>
        <button onClick={next} className="rounded-xl px-5 py-2.5 font-sans text-[14px] font-medium text-[#F7F7F4]" style={{ background: "var(--accent)" }}>Next →</button>
      </div>
    </main>
  );
}
