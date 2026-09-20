import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getHouseBySlug, houseNameForSlug } from "@/lib/houses";
import { supabaseServer } from "@/lib/supabaseServer";
import OpeningEditor from "./OpeningEditor";

export const dynamic = "force-dynamic";

// /h/<slug>/office/hiring/<opening> — opening detail.
// JD editor, "post to" panel, applicants list.

export default async function OpeningDetailPage({
  params,
}: {
  params: { house: string; opening: string };
}) {
  const slug = params.house;
  const openingId = params.opening;
  const house = await getHouseBySlug(slug);
  if (!house) redirect("/studio");
  const entity_id = house.id;

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user?.id) redirect(`/login?next=/h/${slug}/office/hiring/${openingId}`);

  const [openingRes, postsRes, candidatesRes] = await Promise.all([
    sb
      .from("job_openings")
      .select(
        "id, entity_id, title, role, station, description, hours_per_week, hourly_rate_eur, start_date, languages_required, status, created_at, updated_at"
      )
      .eq("id", openingId)
      .maybeSingle(),
    sb
      .from("job_posts")
      .select("id, channel, channel_target, message_body, posted_at, external_ref, status, created_at")
      .eq("job_opening_id", openingId)
      .order("created_at", { ascending: false }),
    sb
      .from("candidates")
      .select("id, name, status, source, languages, right_to_work, years_experience, updated_at")
      .eq("job_opening_id", openingId)
      .order("updated_at", { ascending: false }),
  ]);

  if (!openingRes.data) return notFound();
  if (openingRes.data.entity_id !== entity_id) return notFound();

  const opening = openingRes.data;
  const posts = postsRes.data || [];
  const candidates = candidatesRes.data || [];
  const houseName = houseNameForSlug(slug);

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <div className="border-b border-black/10 pb-4">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">
          Hiring · {houseName}
        </p>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="font-serif text-2xl">{opening.title}</h1>
          <span className="rounded bg-black/5 px-2 py-0.5 text-[11px] uppercase tracking-wide">
            {opening.status}
          </span>
        </div>
        <p className="mt-1 text-xs text-clay">
          {opening.role || "—"}
          {opening.station ? ` · ${opening.station}` : ""}
          {opening.hours_per_week ? ` · ${opening.hours_per_week}h/wk` : ""}
          {opening.hourly_rate_eur ? ` · €${opening.hourly_rate_eur}/h` : ""}
        </p>
      </div>

      <OpeningEditor slug={slug} opening={opening as any} initialPosts={posts as any} />

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-clay">
          Applicants — <span className="tabular-nums">{candidates.length}</span>
        </h2>
        {candidates.length ? (
          <ul className="mt-2 divide-y divide-black/10 rounded border border-black/10 bg-white">
            {candidates.map((c) => (
              <li key={c.id} className="flex items-baseline justify-between px-3 py-2 text-sm">
                <div>
                  <div className="font-medium">{c.name}</div>
                  <div className="text-[11px] text-clay">
                    {c.source || "—"}
                    {c.years_experience ? ` · ${c.years_experience}y` : ""}
                    {c.languages?.length ? ` · ${c.languages.join(", ")}` : ""}
                    {c.right_to_work ? ` · rtw:${c.right_to_work}` : ""}
                  </div>
                </div>
                <span className="rounded bg-black/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
                  {c.status}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-clay">No applicants yet.</p>
        )}
      </section>

      <p className="mt-8 text-xs">
        <Link href={`/h/${slug}/office/hiring`} className="underline">
          ← back to hiring
        </Link>
      </p>
    </main>
  );
}
