import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabaseServer";
import { getMyMembershipContext } from "@/lib/memberships";
import { isOperating } from "@/lib/access/tenantScope";
import { getHouseSnapshots } from "@/lib/studio/houseSnapshots.server";
import { todayInTz } from "@/lib/studio/closeStatus";
import { HousePosBlock } from "../HousePosBlock";

export const dynamic = "force-dynamic";

// /studio/houses — Studio-scoped portfolio list (task #60).
//
// The Studio sidebar's "Houses" link lands HERE and stays in Studio scope:
// sidebar stays STUDIO, logo stays Food Studios. Only clicking a house tile
// crosses the boundary into /h/<slug> (that house's own chrome).
//
// 2026-09-21 polish: houses come from the tenant-filtered entity list
// (ctx.entities — members see their own houses, owners see the houses they
// own), hrefs use entities.slug (no name→UUID maps, so Utopia and any new
// tenant resolve), and the tile's POS block is the shared HousePosBlock:
// "Last close DD MMM" + STALE when > 48h (task #58).

export default async function StudioHousesPage() {
  const sb = supabaseServer();
  const { data: userRes } = await sb.auth.getUser();
  if (!userRes?.user) redirect("/welcome");

  const ctx = await getMyMembershipContext();
  if (!ctx.isOwner && !ctx.isMulti && ctx.memberships.length === 1) {
    const m = ctx.memberships[0];
    if (m.room !== "studio") redirect(`/${m.room === "kitchen" ? "boh" : m.room === "dining" ? "foh" : "office"}`);
  }

  const houses = ctx.entities
    .filter((e) => isOperating(e.entity_type) && e.status === "active")
    .sort((a, b) => a.name.localeCompare(b.name));
  const snaps = await getHouseSnapshots(houses.map((h) => h.id));

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-4">
        <Link href="/studio" className="font-mono text-[10px] uppercase tracking-wide text-clay">← Food Studios</Link>
      </div>
      <h1 className="font-serif text-[34px] leading-[1.05] text-ink">Houses</h1>
      <p className="mt-2 font-serif italic text-[14px] text-ink-soft">
        The portfolio of operating venues. Click a house to leave the Studio and enter its rooms.
      </p>

      {houses.length === 0 ? (
        <section className="mt-10 rounded-2xl border border-dashed border-line p-8 text-center">
          <p className="font-serif italic text-[15px] text-ink-soft">No operating houses yet.</p>
        </section>
      ) : (
        <ul className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {houses.map((e) => {
            const snap = snaps.get(e.id);
            const href = e.slug ? `/h/${e.slug}` : "/studio/houses";
            return (
              <li key={e.id}>
                <Link
                  href={href}
                  className="block rounded-lg border border-black/10 bg-paper/50 p-5 transition hover:border-ink/40 hover:bg-paper"
                >
                  <p className="font-serif text-[20px] text-ink leading-tight">{e.name}</p>
                  <HousePosBlock
                    pos={snap?.pos ?? null}
                    restaurantId={snap?.restaurant_id ?? null}
                    today={todayInTz(e.timezone || "Europe/Madrid")}
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
