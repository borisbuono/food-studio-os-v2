import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";
import { serverRestaurantId } from "@/lib/serverVenue";
import ReputationInboxClient from "./ReputationInboxClient";

export const dynamic = "force-dynamic";

type ReviewRow = {
  id: string;
  platform: string;
  external_id: string;
  reviewer_name: string | null;
  rating: number | null;
  title: string | null;
  body: string | null;
  language: string | null;
  posted_at: string;
  response_body: string | null;
  response_posted_at: string | null;
  sentiment: string | null;
  tags: string[] | null;
  url: string | null;
};
type StatusRow = {
  platform: string;
  avg_rating: number | null;
  total_reviews: number;
  reviews_this_month: number;
  unreplied_count: number;
  last_synced_at: string | null;
  last_error: string | null;
};

const PLATFORMS = [
  { key: "google_business", label: "Google" },
  { key: "tripadvisor", label: "TripAdvisor" },
  { key: "thefork", label: "TheFork" },
] as const;

export default async function GrowReputation() {
  const sb = supabaseServer();
  const rid = serverRestaurantId();

  const [{ data: reviews }, { data: status }] = await Promise.all([
    sb.from("reviews")
      .select("id,platform,external_id,reviewer_name,rating,title,body,language,posted_at,response_body,response_posted_at,sentiment,tags,url")
      .eq("restaurant_id", rid)
      .order("posted_at", { ascending: false })
      .limit(200),
    sb.from("reviews_platform_status")
      .select("platform,avg_rating,total_reviews,reviews_this_month,unreplied_count,last_synced_at,last_error")
      .eq("restaurant_id", rid),
  ]);

  const statusByPlatform: Record<string, StatusRow | undefined> = {};
  for (const s of (status || []) as StatusRow[]) statusByPlatform[s.platform] = s;

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Link href="/" className="font-sans text-sm text-ink-soft">← home</Link>

      <header className="mt-4 flex items-baseline justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wide text-tomato">Grow · Reputation</p>
          <h1 className="mt-1 font-serif text-3xl text-ink">Reviews inbox</h1>
        </div>
        <Link href="/grow/reputation/settings" className="rounded-full border border-line bg-paper px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-ink hover:border-ink-soft">settings ⚙</Link>
      </header>

      {/* Platform tiles */}
      <section className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {PLATFORMS.map((p) => {
          const s = statusByPlatform[p.key];
          return (
            <div key={p.key} className="rounded-xl border border-line bg-paper p-4">
              <p className="font-mono text-[10px] uppercase tracking-wide text-clay">{p.label}</p>
              <p className="mt-2 font-serif text-[26px] leading-none text-ink">
                {s?.avg_rating != null ? s.avg_rating.toFixed(1) : "—"}
                <span className="ml-1 font-mono text-[11px] text-muted">avg</span>
              </p>
              <p className="mt-1 font-mono text-[10px] text-muted">
                {s?.reviews_this_month ?? 0} this month · {s?.unreplied_count ?? 0} awaiting reply
              </p>
              {s?.last_error ? (
                <p className="mt-2 font-mono text-[10px] text-tomato">⚠ {s.last_error.slice(0, 80)}</p>
              ) : s?.last_synced_at ? (
                <p className="mt-2 font-mono text-[10px] text-muted">synced {new Date(s.last_synced_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
              ) : (
                <p className="mt-2 font-mono text-[10px] text-muted">not yet synced</p>
              )}
            </div>
          );
        })}
      </section>

      <ReputationInboxClient reviews={(reviews || []) as ReviewRow[]} />
    </main>
  );
}
