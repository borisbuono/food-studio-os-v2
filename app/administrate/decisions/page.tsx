import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { noEmoji } from "@/lib/text";

export const dynamic = "force-dynamic";

function clip(s: string, n = 200) { s = (s || "").trim(); return s.length > n ? s.slice(0, n).trim() + "…" : s; }

export default async function Decisions() {
  const items = (await supabase.from("inbox_items").select("source,category,sender_name,subject,body,received_at,status,priority").order("received_at", { ascending: false })).data || [];
  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/administrate" className="font-sans text-sm text-ink-soft">← administrate</Link>
      <p className="mt-6 font-sans text-xs font-medium text-ember">Decisions · inbox</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">What needs a call</h1>

      <div className="mt-8 space-y-4">
        {items.map((it: any, i: number) => (
          <div key={i} className="rounded-2xl border border-black/10 bg-card p-6">
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="font-serif text-xl text-ink">{noEmoji(it.subject || it.category || "Item")}</h2>
              <span className="font-mono text-[10px] uppercase tracking-wide text-clay">{it.priority || it.status || ""}</span>
            </div>
            <p className="mt-1 font-mono text-[11px] text-clay">{[it.source, it.sender_name].filter(Boolean).join(" · ")}</p>
            {it.body ? <p className="mt-3 font-sans text-[14px] leading-relaxed text-ink-soft">{clip(it.body)}</p> : null}
          </div>
        ))}
        {!items.length ? <p className="font-sans text-[14px] text-clay">Inbox is clear.</p> : null}
      </div>
      <p className="mt-8 font-mono text-[10px] uppercase tracking-wide text-clay">Stakeholder voting on decisions arrives next</p>
    </main>
  );
}
