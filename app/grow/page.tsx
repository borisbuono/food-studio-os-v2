import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";
import { serverRestaurantId } from "@/lib/serverVenue";
import { getBindings } from "@/lib/integrations/registry";

export const dynamic = "force-dynamic";

export default async function GrowHome() {
  const supabase = supabaseServer();
  const rid = serverRestaurantId();

  // Relationships tile — read guest snapshot
  const nowIso = new Date().toISOString();
  const monthStart = new Date();
  monthStart.setDate(1);
  const monthStartIso = monthStart.toISOString();
  const guestsAll = (await supabase.from("guests").select("id,birthday,created_at,last_visit_at").eq("restaurant_id", rid)).data || [];
  const guestCount = guestsAll.length;
  const newThisMonth = guestsAll.filter((g: any) => g.created_at && g.created_at >= monthStartIso).length;
  // birthday-week + birthday-month
  const today = new Date();
  const wkAhead = new Date(today.getTime() + 7 * 24 * 3600 * 1000);
  const bdWeek = guestsAll.filter((g: any) => {
    if (!g.birthday) return false;
    const m = Number(g.birthday.slice(5, 7));
    const d = Number(g.birthday.slice(8, 10));
    if (!m || !d) return false;
    // cross-year: build this-year candidate; if it's already passed by >1d, use next-year
    const thisYear = new Date(today.getFullYear(), m - 1, d);
    const cand = thisYear.getTime() < today.getTime() - 24 * 3600 * 1000 ? new Date(today.getFullYear() + 1, m - 1, d) : thisYear;
    return cand >= today && cand <= wkAhead;
  }).length;
  const bdMonth = guestsAll.filter((g: any) => g.birthday && Number(g.birthday.slice(5, 7)) === today.getMonth() + 1).length;

  // Commercials tile
  const coms = (await supabase.from("commercials").select("id,active,starts_at,ends_at").eq("restaurant_id", rid)).data || [];
  const activeCount = coms.filter((c: any) => c.active && (!c.starts_at || c.starts_at <= nowIso) && (!c.ends_at || c.ends_at >= nowIso)).length;
  const upcomingCount = coms.filter((c: any) => c.active && c.starts_at && c.starts_at > nowIso).length;
  const activeIds = coms.filter((c: any) => c.active).map((c: any) => c.id);
  let itemsOnOffer = 0;
  if (activeIds.length) {
    const { count } = await supabase.from("commercial_items").select("id", { count: "exact", head: true }).in("commercial_id", activeIds);
    itemsOnOffer = count || 0;
  }

  // Reach + Reputation — read adapter binding status
  let reachStatus = "off";
  let reputationStatus = "off";
  try {
    const bindings = getBindings();
    const b = bindings[0]; // per-entity summary — pick head to display
    reachStatus = b?.marketing?.status || "off";
    reputationStatus = b?.reviews?.status || "off";
  } catch { /* ignore — landing must never crash */ }

  const lbl = "font-mono text-[10px] uppercase tracking-wide text-clay";
  const val = "font-serif text-2xl leading-none text-ink";

  const Tile = ({ href, kicker, title, children }: { href: string; kicker: string; title: string; children: React.ReactNode }) => (
    <Link href={href} className="group block border-t border-line py-6 transition hover:opacity-80">
      <p className={lbl}>{kicker}</p>
      <h2 className="mt-2 font-serif text-2xl text-ink">{title}</h2>
      <div className="mt-3 text-ink-soft">{children}</div>
      <p className="mt-3 font-mono text-[10px] uppercase tracking-wide" style={{ color: "var(--accent)" }}>Open →</p>
    </Link>
  );

  const StatRow = ({ items }: { items: { label: string; value: string | number }[] }) => (
    <div className="grid grid-cols-3 gap-4">
      {items.map((s, i) => (
        <div key={i}>
          <p className={val}>{s.value}</p>
          <p className={lbl + " mt-1"}>{s.label}</p>
        </div>
      ))}
    </div>
  );

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <Link href="/" className="font-sans text-sm text-ink-soft">← home</Link>
      <p className="mt-6 font-mono text-[10px] uppercase tracking-wide" style={{ color: "var(--accent)" }}>Grow · outward-facing</p>
      <h1 className="mt-2 font-serif text-4xl leading-tight text-ink">The fourth pillar.</h1>
      <p className="mt-2 font-serif italic text-[15px] text-ink-soft">
        How we tell people, who they are, what they say back. Relationships, Commercials, Reach, Reputation.
      </p>

      <section className="mt-10">
        <Tile href="/grow/relationships" kicker="Relationships · guest CRM" title="Who are our guests?">
          <StatRow items={[
            { label: "Guests", value: guestCount },
            { label: "New this month", value: newThisMonth },
            { label: bdWeek > 0 ? "Birthdays this week" : "Birthdays this month", value: bdWeek > 0 ? bdWeek : bdMonth },
          ]} />
        </Tile>

        <Tile href="/grow/commercials" kicker="Commercials · offers" title="What are we offering?">
          <StatRow items={[
            { label: "Active offers", value: activeCount },
            { label: "Items on offer", value: itemsOnOffer },
            { label: "Upcoming", value: upcomingCount },
          ]} />
        </Tile>

        <Tile href="/grow/reach" kicker="Reach · campaigns" title="How are we telling people?">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="font-mono text-[13px] text-ink capitalize">{reachStatus}</p>
              <p className={lbl + " mt-1"}>Wix Newsletter</p>
            </div>
            <div>
              <p className="font-mono text-[13px] text-ink capitalize">stub</p>
              <p className={lbl + " mt-1"}>Buffer social</p>
            </div>
            <div>
              <p className="font-mono text-[13px] text-clay">—</p>
              <p className={lbl + " mt-1"}>Next campaign</p>
            </div>
          </div>
          <p className="mt-3 font-serif italic text-[12px] text-clay">Composer lands with the Klaviyo adapter (Sprint 3).</p>
        </Tile>

        <Tile href="/grow/reputation" kicker="Reputation · reviews" title="What are they saying?">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="font-mono text-[13px] text-ink capitalize">{reputationStatus}</p>
              <p className={lbl + " mt-1"}>Google Business</p>
            </div>
            <div>
              <p className="font-mono text-[13px] text-clay">—</p>
              <p className={lbl + " mt-1"}>Reviews inbox</p>
            </div>
            <div>
              <p className="font-mono text-[13px] text-clay">—</p>
              <p className={lbl + " mt-1"}>Avg rating</p>
            </div>
          </div>
          <p className="mt-3 font-serif italic text-[12px] text-clay">Aggregation + reply flow ships with the ReviewsAdapter (Sprint 4).</p>
        </Tile>
      </section>

      <p className="mt-10 font-mono text-[10px] uppercase tracking-wide text-clay border-t border-line pt-4">
        Grow inbox · reviews & signals — <Link href="/grow/inbox" className="text-tomato hover:text-ink">open ›</Link>
      </p>
    </main>
  );
}
