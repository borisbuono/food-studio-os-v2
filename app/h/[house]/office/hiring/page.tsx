import Link from "next/link";
import { redirect } from "next/navigation";
import { houseNameForSlug } from "@/lib/houses";
import { getHouseBySlug } from "@/lib/houses.server";
import { supabaseServer } from "@/lib/supabaseServer";
import { ACTIVE_CANDIDATE_STATUSES } from "@/lib/hiring";
import CandidateKanban from "./CandidateKanban";

export const dynamic = "force-dynamic";

// /h/<slug>/office/hiring — main HR surface.
//
// Header counts · openings cards · candidate kanban · filter chips.

type Opening = {
  id: string;
  title: string;
  role: string | null;
  station: string | null;
  status: string;
  hours_per_week: number | null;
  hourly_rate_eur: number | null;
  created_at: string;
};

type Candidate = {
  id: string;
  entity_id: string;
  job_opening_id: string | null;
  name: string;
  status: string;
  source: string | null;
  languages: string[] | null;
  right_to_work: string | null;
  updated_at: string;
  years_experience: number | null;
};

export default async function HiringPage({ params }: { params: { house: string } }) {
  const slug = params.house;
  const house = await getHouseBySlug(slug);
  if (!house) redirect("/studio");
  const entity_id = house.id;

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user?.id) redirect(`/login?next=/h/${slug}/office/hiring`);

  const [openingsRes, candidatesRes, interviewsRes] = await Promise.all([
    sb
      .from("job_openings")
      .select("id, title, role, station, status, hours_per_week, hourly_rate_eur, created_at")
      .eq("entity_id", entity_id)
      .order("created_at", { ascending: false }),
    sb
      .from("candidates")
      .select(
        "id, entity_id, job_opening_id, name, status, source, languages, right_to_work, updated_at, years_experience"
      )
      .eq("entity_id", entity_id)
      .order("updated_at", { ascending: false }),
    sb
      .from("interviews")
      .select("id, candidate_id, scheduled_at, status, candidates!inner(entity_id)")
      .eq("candidates.entity_id", entity_id)
      .gte("scheduled_at", new Date().toISOString())
      .lte("scheduled_at", new Date(Date.now() + 7 * 86400_000).toISOString()),
  ]);

  const openings = (openingsRes.data || []) as Opening[];
  const candidates = (candidatesRes.data || []) as Candidate[];
  const upcomingInterviews = (interviewsRes.data || []) as Array<{ id: string }>;

  const openCount = openings.filter((o) => o.status === "open").length;
  const activeCandidates = candidates.filter((c) =>
    ACTIVE_CANDIDATE_STATUSES.includes(c.status as any)
  );
  const interviewsThisWeek = upcomingInterviews.length;

  const candidatesByOpening = new Map<string, number>();
  for (const c of candidates) {
    if (!c.job_opening_id) continue;
    candidatesByOpening.set(c.job_opening_id, (candidatesByOpening.get(c.job_opening_id) || 0) + 1);
  }

  const houseName = houseNameForSlug(slug);

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-black/10 pb-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Hiring · {houseName}</p>
          <h1 className="font-serif text-2xl">HR funnel</h1>
          <p className="mt-1 text-xs text-clay">
            <span className="tabular-nums">{openCount}</span> open ·{" "}
            <span className="tabular-nums">{activeCandidates.length}</span> candidates in flight ·{" "}
            <span className="tabular-nums">{interviewsThisWeek}</span> interviews this week
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/h/${slug}/office/hiring/new`}
            className="rounded border border-black/15 bg-black px-3 py-1.5 text-xs text-white"
          >
            New opening
          </Link>
        </div>
      </div>

      {/* Openings */}
      <section className="mt-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-clay">Openings</h2>
        {openings.length ? (
          <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {openings.map((o) => {
              const applicants = candidatesByOpening.get(o.id) || 0;
              return (
                <li
                  key={o.id}
                  className={`rounded border border-black/10 bg-white px-3 py-2.5 text-sm ${
                    o.status !== "open" ? "opacity-60" : ""
                  }`}
                >
                  <Link href={`/h/${slug}/office/hiring/${o.id}`} className="block">
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="font-medium">{o.title}</div>
                      <span className="rounded bg-black/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
                        {o.status}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-clay">
                      {o.role || "—"}
                      {o.station ? ` · ${o.station}` : ""}
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[11px] text-clay">
                      <span>
                        {o.hours_per_week ? `${o.hours_per_week}h/wk` : ""}
                        {o.hourly_rate_eur ? ` · €${o.hourly_rate_eur}/h` : ""}
                      </span>
                      <span className="tabular-nums">{applicants} applicant{applicants === 1 ? "" : "s"}</span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-clay">
            No openings yet. <Link href={`/h/${slug}/office/hiring/new`} className="underline">Create one</Link>.
          </p>
        )}
      </section>

      {/* Candidate kanban */}
      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-clay">Candidates in flight</h2>
        <CandidateKanban
          slug={slug}
          entityId={entity_id}
          openings={openings.map((o) => ({ id: o.id, title: o.title }))}
          candidates={candidates}
        />
      </section>
    </main>
  );
}
