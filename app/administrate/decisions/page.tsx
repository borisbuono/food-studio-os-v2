import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { serverRestaurantId } from "@/lib/serverVenue";
import { noEmoji } from "@/lib/text";

export const dynamic = "force-dynamic";

type Item = { kind: "external" | "feedback"; id: string; title: string; body: string; who: string; source: string; flag: string; at: string; route: string | null };
function clip(s: string, n = 220) { s = (s || "").trim(); return s.length > n ? s.slice(0, n).trim() + "…" : s; }
const when = (t: string) => { const d = new Date(t); const m = Math.floor((Date.now() - d.getTime()) / 60000); if (m < 60) return m + "m"; const h = Math.floor(m / 60); if (h < 24) return h + "h"; return Math.floor(h / 24) + "d"; };

export default async function Inbox() {
  const rid = serverRestaurantId();
  const [{ data: ext }, { data: fb }] = await Promise.all([
    supabase.from("inbox_items").select("id,source,category,sender_name,subject,body,received_at,status,priority").eq("restaurant_id", rid).order("received_at", { ascending: false }),
    supabase.from("feedback").select("id,route,kind,status,priority,author_name,author_role,body,created_at").eq("restaurant_id", rid).neq("status", "done").neq("status", "wontfix").order("created_at", { ascending: false }),
  ]);
  const items: Item[] = [
    ...((ext || []) as any[]).map((it) => ({ kind: "external" as const, id: it.id, title: noEmoji(it.subject || it.category || "Item"), body: it.body || "", who: it.sender_name || "", source: it.source || "", flag: (it.priority || it.status || ""), at: it.received_at, route: null })),
    ...((fb || []) as any[]).map((it) => ({ kind: "feedback" as const, id: it.id, title: clip(it.body, 80), body: it.body || "", who: it.author_name || "", source: it.kind, flag: it.priority === "high" ? "high" : it.status, at: it.created_at, route: it.route })),
  ].sort((a, b) => (b.at || "").localeCompare(a.at || ""));

  const counts = { all: items.length, external: items.filter((i) => i.kind === "external").length, feedback: items.filter((i) => i.kind === "feedback").length };

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/" className="font-sans text-sm text-ink-soft">← home</Link>
      <p className="mt-6 font-sans text-xs font-medium text-ochre">Inbox · everything that wants you</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">What needs a call</h1>
      <p className="mt-2 font-sans text-[14px] text-ink-soft">{counts.all} open · {counts.external} from outside · {counts.feedback} from the team. One inbox — emails, requests, reviews and the team's own notes.</p>

      <ul className="mt-8 space-y-3">
        {items.map((it) => (
          <li key={it.kind + ":" + it.id} className="rounded-2xl border border-black/10 bg-card p-5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-mono text-[10px] uppercase tracking-wide" style={{ color: it.kind === "feedback" ? "#0E7C86" : "#B5701C" }}>{it.kind === "feedback" ? "from the team · " + it.source : it.source}{it.flag && it.flag !== "new" ? " · " + it.flag : ""}</span>
              <span className="font-mono text-[10px] text-clay">{when(it.at)} ago{it.route ? " · " + it.route : ""}</span>
            </div>
            <p className="mt-2 font-serif text-[17px] leading-relaxed text-ink">{it.title}</p>
            {it.kind === "external" && it.body ? <p className="mt-1 font-serif text-[15px] leading-relaxed text-ink-soft">{clip(it.body)}</p> : null}
            <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-clay">{it.who || (it.kind === "feedback" ? "someone on the team" : "")}</p>
          </li>
        ))}
        {!items.length ? <li className="font-sans text-[14px] text-clay">Inbox is clear.</li> : null}
      </ul>
    </main>
  );
}
