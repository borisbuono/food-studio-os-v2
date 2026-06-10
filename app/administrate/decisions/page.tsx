import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";
import { serverRestaurantId } from "@/lib/serverVenue";
import { noEmoji } from "@/lib/text";

export const dynamic = "force-dynamic";

type Item = {
  kind: "external" | "feedback";
  id: string;
  src: string; // canonical source key for filtering: gmail | google_reviews | whatsapp | team | other
  title: string;
  body: string;
  who: string;
  handle: string;
  label: string; // human source label shown on the chip
  flag: string;
  rating: number | null;
  url: string | null;
  at: string;
  route: string | null;
};

function clip(s: string, n = 220) { s = (s || "").trim(); return s.length > n ? s.slice(0, n).trim() + "…" : s; }
const when = (t: string) => { const d = new Date(t); const m = Math.floor((Date.now() - d.getTime()) / 60000); if (m < 1) return "just now"; if (m < 60) return m + "m"; const h = Math.floor(m / 60); if (h < 24) return h + "h"; return Math.floor(h / 24) + "d"; };

// External-source presentation. Read-only mirrors of outside channels — no replying from here yet.
const SOURCE_META: Record<string, { label: string; color: string }> = {
  gmail: { label: "Email", color: "#B5701C" },
  google_reviews: { label: "Google review", color: "#5A6B3B" },
  whatsapp: { label: "WhatsApp", color: "#3E5A37" },
  agent_dispatch: { label: "Agent", color: "#9C9282" },
};
const sourceKey = (s: string) => (s === "gmail" ? "gmail" : s === "google_reviews" ? "google_reviews" : s === "whatsapp" ? "whatsapp" : "other");
const stars = (n: number) => "★★★★★☆☆☆☆☆".slice(5 - n, 10 - n); // n filled then (5-n) empty

const TABS: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "gmail", label: "Email" },
  { key: "google_reviews", label: "Reviews" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "team", label: "Team" },
];

export default async function Inbox({ searchParams }: { searchParams?: { src?: string } }) {
  
  const supabase = supabaseServer();const rid = serverRestaurantId();
  const active = (searchParams?.src && TABS.some((t) => t.key === searchParams.src)) ? searchParams!.src! : "all";

  const [{ data: ext }, { data: fb }] = await Promise.all([
    supabase.from("inbox_items").select("id,source,category,sender_name,sender_handle,subject,body,received_at,status,priority,external_url,metadata").eq("restaurant_id", rid).order("received_at", { ascending: false }),
    supabase.from("feedback").select("id,route,kind,status,priority,author_name,author_role,body,created_at").eq("restaurant_id", rid).neq("status", "done").neq("status", "wontfix").order("created_at", { ascending: false }),
  ]);

  const all: Item[] = [
    ...((ext || []) as any[]).map((it) => {
      const meta = (it.metadata || {}) as any;
      const sk = sourceKey(it.source);
      const sm = SOURCE_META[it.source] || { label: it.source || "Outside", color: "#9C9282" };
      const rating = typeof meta.rating === "number" ? meta.rating : null;
      return {
        kind: "external" as const,
        id: it.id,
        src: sk,
        title: noEmoji(it.subject || it.category || (sk === "google_reviews" ? "New review" : "Message")),
        body: it.body || "",
        who: it.sender_name || "",
        handle: it.sender_handle || "",
        label: sm.label,
        flag: it.priority && it.priority !== "normal" ? it.priority : (it.status && it.status !== "new" ? it.status : ""),
        rating,
        url: it.external_url || null,
        at: it.received_at,
        route: null,
      } as Item;
    }),
    ...((fb || []) as any[]).map((it) => ({
      kind: "feedback" as const,
      id: it.id,
      src: "team",
      title: clip(it.body, 80),
      body: it.body || "",
      who: it.author_name || "",
      handle: it.author_role || "",
      label: "From the team · " + it.kind,
      flag: it.priority === "high" ? "high" : it.status,
      rating: null,
      url: null,
      at: it.created_at,
      route: it.route,
    } as Item)),
  ].sort((a, b) => (b.at || "").localeCompare(a.at || ""));

  const items = active === "all" ? all : all.filter((i) => i.src === active);

  const counts = {
    all: all.length,
    external: all.filter((i) => i.kind === "external").length,
    feedback: all.filter((i) => i.kind === "feedback").length,
  };
  const tabCount = (k: string) => (k === "all" ? all.length : all.filter((i) => i.src === k).length);

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/" className="font-sans text-sm text-ink-soft">← home</Link>
      <p className="mt-6 font-sans text-xs font-medium text-ochre">Inbox · everything that wants you</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">What needs a call</h1>
      <p className="mt-2 font-sans text-[14px] text-ink-soft">{counts.all} open · {counts.external} from outside · {counts.feedback} from the team. One inbox — email, reviews, WhatsApp and the team's own notes. Outside channels are mirrored read-only.</p>

      <nav className="mt-6 flex flex-wrap gap-2">
        {TABS.map((t) => {
          const on = t.key === active;
          return (
            <Link key={t.key} href={t.key === "all" ? "/administrate/decisions" : `/administrate/decisions?src=${t.key}`}
              className={"rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-wide " + (on ? "bg-ink text-paper" : "border border-black/10 text-ink-soft")}>
              {t.label} {tabCount(t.key) ? <span className={on ? "text-paper/70" : "text-clay"}>· {tabCount(t.key)}</span> : null}
            </Link>
          );
        })}
      </nav>

      <ul className="mt-8 space-y-3">
        {items.map((it) => {
          const sm = it.kind === "external" ? (SOURCE_META[it.src === "google_reviews" ? "google_reviews" : it.src === "gmail" ? "gmail" : it.src === "whatsapp" ? "whatsapp" : "agent_dispatch"]) : null;
          const color = it.kind === "feedback" ? "#0E7C86" : (sm?.color || "#B5701C");
          const inner = (
            <>
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-mono text-[10px] uppercase tracking-wide" style={{ color }}>
                  {it.label}{it.flag && it.flag !== "new" ? " · " + it.flag : ""}
                  {it.kind === "external" ? <span className="text-clay"> · mirror</span> : null}
                </span>
                <span className="font-mono text-[10px] text-clay">{when(it.at)} ago{it.route ? " · " + it.route : ""}</span>
              </div>

              {it.kind === "external" && it.rating != null ? (
                <p className="mt-2 font-mono text-[13px] tracking-[0.15em]" style={{ color: "#B5701C" }}>{stars(Math.max(0, Math.min(5, it.rating)))} <span className="text-clay text-[10px]">{it.rating}/5</span></p>
              ) : null}

              <p className="mt-2 font-serif text-[17px] leading-relaxed text-ink">{it.title}</p>
              {it.kind === "external" && it.body ? <p className="mt-1 font-serif text-[15px] leading-relaxed text-ink-soft">{clip(it.body)}</p> : null}

              <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-clay">
                {it.who || (it.kind === "feedback" ? "someone on the team" : "outside")}
                {it.handle ? " · " + it.handle : ""}
                {it.url ? " · open ↗" : ""}
              </p>
            </>
          );
          return (
            <li key={it.kind + ":" + it.id} className="rounded-2xl border border-black/10 bg-card p-5">
              {it.url ? <a href={it.url} target="_blank" rel="noreferrer" className="block">{inner}</a> : inner}
            </li>
          );
        })}
        {!items.length ? <li className="font-sans text-[14px] text-clay">{active === "all" ? "Inbox is clear." : "Nothing here right now."}</li> : null}
      </ul>
    </main>
  );
}
