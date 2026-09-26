import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabaseServer";
import { houseNameForSlug, houseLocale, houseMoney, type House } from "@/lib/houses";
import { HOUSE_VERBS } from "@/lib/nav";
import { verbLabel } from "@/lib/nav/labels";
import { serverLang } from "@/lib/i18nServer";
import { resolveHouseHref } from "@/lib/scope";
import { getHouseBySlug } from "@/lib/houses.server";
import { ENTITY_H1, publicNameForEntity, type EntityKey } from "@/lib/entities";
import { HourlySpark } from "@/app/studio/HourlySpark";

// /h/<slug> — the house landing page.
//
// Push (2026-09-11, Boris walk): this used to set fs_entity and redirect to
// /office, which meant tapping a house tile on /studio dropped the user on
// a generic operating surface with no house identity. The landing now
// mirrors the Studio landing structure but house-scoped: house name,
// bespoke subtitle, yesterday's numbers, and the six verbs (rooms left the
// nav 2026-09-26).
//
// fs_entity is still set so subsequent nav (legacy /office / /boh / /foh)
// stays bound to this house.

export const dynamic = "force-dynamic";

// P0 fix 2026-09-20 (Amsterdam rehearsal): the two hardcoded maps used to
// live here (HOUSE_SLUG_TO_RESTAURANT_ID, HOUSE_SUBTITLE) — both keyed on
// "bm" / "taller" and both returned empty for any other tenant. They are
// gone. restaurant_id now comes from the entity's linked restaurants row
// (getHouseBySlug()), the subtitle is derived from legal_name + city on
// the entities row, and every formatter takes an explicit `tz` string
// resolved once from house.timezone at the top of the render.

// Money + dates follow the HOUSE's currency and locale — a US tenant used to
// see "€" on dollars and en-GB dates (stress test 2026-09-21, polish list).
function eur(house: House, n: number): string {
  return houseMoney(house, n, 0);
}
function tzDateLabel(house: House, tz: string): string {
  return new Intl.DateTimeFormat(houseLocale(house), {
    timeZone: tz, weekday: "long", day: "numeric", month: "long",
  }).format(new Date());
}
function tzClock(house: House, tz: string): string {
  return new Intl.DateTimeFormat(houseLocale(house), {
    timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date());
}
// Human-readable close date — "3 Sep", "yesterday", "today". Same helper as
// the Studio tile so the two surfaces read the same way.
function humanDate(house: House, iso: string, today: string): string {
  if (iso === today) return "today";
  const yest = new Date(today + "T12:00:00Z");
  yest.setUTCDate(yest.getUTCDate() - 1);
  if (iso === yest.toISOString().slice(0, 10)) return "yesterday";
  const d = new Date(iso + "T12:00:00Z");
  return new Intl.DateTimeFormat(houseLocale(house), { day: "numeric", month: "short", timeZone: "UTC" }).format(d);
}
function tzToday(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}
// "Madrid" / "Amsterdam" — used in the top-strip clock caption. The zone
// database format is "Continent/City", so the tail after the slash is a
// serviceable human label.
function tzShortLabel(tz: string): string {
  const tail = tz.split("/").pop() || tz;
  return tail.replace(/_/g, " ");
}

type EodRow = {
  date: string;
  total_gross_eur: number | null;
  tickets: number | null;
  guests: number | null;
  guests_daily: number | null;
  peak_hour: string | null;
  peak_hour_revenue: number | null;
  hourly_revenue: Record<string, number> | null;
};

export default async function HouseLandingPage({ params }: { params: { house: string } }) {
  const slug = params.house;
  const lang = serverLang();
  const house = await getHouseBySlug(slug);
  if (!house) redirect("/studio");
  const entity = house.id;

  // fs_entity is bound by middleware.ts on every /h/<slug>/** request
  // (2026-09-22). It used to be set here with cookies().set(), which Next
  // refuses inside a Server Component render — the try/catch hid the error
  // and the cookie was never written, so the first legacy link in the
  // house sidebar dropped the user back into Studio scope.

  const rid = house.restaurant_id ?? undefined;
  // Pinned entities (BM/Taller) still resolve to their pretty trading name
  // via publicNameForEntity; new tenants get the DB name. legal_name + city
  // together drive the subtitle — the old hardcoded "Bistro Mondo · Sant Joan
  // de Labritja" strings are gone.
  const houseName = publicNameForEntity(entity) || house.name;
  const subtitleParts = [
    "Legal entity",
    house.legal_name || house.name,
    house.city || null,
  ].filter(Boolean) as string[];
  const subtitle = subtitleParts.length >= 2 ? subtitleParts.join(" · ") : "";
  const tz = house.timezone;
  const dateLabel = tzDateLabel(house, tz);
  const clock = tzClock(house, tz);
  const today = tzToday(tz);
  const tzLabel = tzShortLabel(tz);
  const h1Class = ENTITY_H1[entity as EntityKey] || "font-serif text-3xl text-ink";

  // Yesterday's close from eod_pos. We ask for the most recent row (which
  // in practice is yesterday for a night-close operation, but might be
  // today if a close already landed).
  let latest: EodRow | null = null;
  if (rid) {
    const sb = supabaseServer();
    const { data: rows } = await sb
      .from("eod_pos")
      .select("date,total_gross_eur,tickets,guests,guests_daily,peak_hour,peak_hour_revenue,hourly_revenue")
      .eq("restaurant_id", rid)
      .order("date", { ascending: false })
      .limit(1);
    if (rows && rows.length) {
      const r: any = rows[0];
      latest = {
        date: String(r.date),
        total_gross_eur: r.total_gross_eur == null ? null : Number(r.total_gross_eur),
        tickets: r.tickets == null ? null : Number(r.tickets),
        guests: r.guests == null ? null : Number(r.guests),
        guests_daily: r.guests_daily == null ? null : Number(r.guests_daily),
        peak_hour: (r.peak_hour as string | null) || null,
        peak_hour_revenue: r.peak_hour_revenue == null ? null : Number(r.peak_hour_revenue),
        hourly_revenue: (r.hourly_revenue as Record<string, number> | null) || null,
      };
    }
  }

  const displayGuests = latest ? (latest.guests_daily ?? latest.guests ?? null) : null;

  // Currently-on-floor count — labor module (runway d2). Cheap head-count
  // over the open-shift index; feeds the daily-loop tile below.
  let onFloor = 0;
  try {
    const sb = supabaseServer();
    const { count } = await sb
      .from("labor_shifts")
      .select("id", { count: "exact", head: true })
      .eq("entity_id", entity)
      .is("clock_out", null)
      .not("clock_in", "is", null);
    onFloor = count || 0;
  } catch { /* table missing on very old envs → tile shows 0 */ }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      {/* Top strip — house identity + date + venue-local clock. */}
      <section className="border-b border-black/10 pb-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wide text-clay">The House</p>
            <h1 className={"mt-1 " + h1Class}>{houseName}</h1>
            {subtitle ? (
              <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-clay">{subtitle}</p>
            ) : null}
          </div>
          <div className="text-right">
            <p className="font-serif text-[17px] text-ink-soft">{dateLabel}</p>
            <p className="font-mono text-[11px] text-clay">{tzLabel} · {clock}</p>
          </div>
        </div>
      </section>

      {/* EOD status tile — surfaces last-close date + a link to the manual
          entry surface. Wired for the runway d2 manual EOD mode; on Fresto
          houses it still lets the operator hop to /office/eod to key an
          exception day by hand. */}
      <section className="mt-8">
        <div className="flex flex-wrap items-baseline justify-between gap-3 border border-line px-4 py-3">
          <p className="font-mono text-[11px] uppercase tracking-wide text-clay">
            EOD status ·{" "}
            {latest ? (
              <>last close {humanDate(house, latest.date, today)}</>
            ) : (
              <>no close on record yet</>
            )}
          </p>
          <Link
            href={`/h/${slug}/office/eod`}
            className="border border-ink px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-ink hover:bg-ink hover:text-paper"
          >
            + Enter today's close
          </Link>
        </div>
      </section>

      {/* On the floor — labor module (runway d2). Live count of open shifts
          for this house; tap-through to the clock kiosk or the labor admin. */}
      <section className="mt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3 border border-line px-4 py-3">
          <p className="font-mono text-[11px] uppercase tracking-wide text-clay">
            On the floor · <span className="tabular-nums text-ink">{onFloor}</span> {onFloor === 1 ? "person" : "people"} clocked in
          </p>
          <div className="flex gap-2">
            <Link
              href={`/h/${slug}/clock`}
              className="border border-ink px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-ink hover:bg-ink hover:text-paper"
            >
              Open clock
            </Link>
            <Link
              href={`/h/${slug}/office/labor`}
              className="border border-black/20 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-ink hover:bg-black/[.04]"
            >
              Labor dashboard
            </Link>
            <Link
              href={`/h/${slug}/office/hiring`}
              className="border border-black/20 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-ink hover:bg-black/[.04]"
            >
              Hiring
            </Link>
            <Link
              href={`/h/${slug}/calendar`}
              className="border border-black/20 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-ink hover:bg-black/[.04]"
            >
              Calendar
            </Link>
          </div>
        </div>
      </section>

      {/* Yesterday's close — one card. Boris rule: money · tickets · guests
          on one line, secondary line = last close date + peak hour. */}
      <section className="mt-8">
        <h2 className="font-mono text-[10px] uppercase tracking-wide text-clay">Latest close</h2>
        {latest ? (
          <div className="mt-3 rounded-lg border border-black/10 bg-paper/50 p-5">
            <p className="font-serif text-[24px] text-ink leading-tight">
              {eur(house, latest.total_gross_eur ?? 0)}
              {latest.tickets != null ? (
                <span className="font-sans text-[15px] text-ink-soft"> · {latest.tickets} tickets</span>
              ) : null}
              {displayGuests != null ? (
                <span className="font-sans text-[15px] text-ink-soft"> · {displayGuests} guests</span>
              ) : null}
            </p>
            <p className="mt-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wide text-clay">
              <span>Last close {humanDate(house, latest.date, today)}</span>
              {latest.peak_hour ? (
                <span title={`Peak revenue hour (${tzLabel})`}>
                  · peak {latest.peak_hour}:00
                  {latest.peak_hour_revenue ? ` (${eur(house, latest.peak_hour_revenue)})` : null}
                </span>
              ) : null}
            </p>
            {latest.hourly_revenue ? (
              <div className="mt-3" aria-hidden="true" title="Hourly revenue — 07..22, peak hour in ink">
                <HourlySpark hourly={latest.hourly_revenue} peakHour={latest.peak_hour} />
              </div>
            ) : null}
          </div>
        ) : (
          <div className="mt-3 rounded-lg border border-black/10 bg-paper/50 p-5">
            <p className="font-sans text-[13px] text-ink-soft">No close yet</p>
          </div>
        )}
      </section>

      {/* The six verbs (slim OS slice 1, 2026-09-26). Rooms are no longer a
          destination; each verb lands on the screen that IS the job. Slice 2
          replaces this page with the idle screen (now strip + control). */}
      <section className="mt-10">
        <h2 className="font-mono text-[10px] uppercase tracking-wide text-clay">Verbs</h2>
        <ul className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-3">
          {HOUSE_VERBS.map((v) => (
            <li key={v.key}>
              <Link
                href={resolveHouseHref(v.href, slug) || `/h/${slug}`}
                className="block rounded-lg border border-black/10 bg-paper/50 p-5 transition hover:border-ink/40 hover:bg-paper"
              >
                <p className="font-serif text-[20px] text-ink">{verbLabel(v, lang)}</p>
                <p className="mt-1 font-sans text-[12px] text-clay">{v.hint}</p>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* Capture — scoped to THIS house. Two buttons, invoice + delivery
          note, route to /capture with the entity pre-bound so the receiving
          surface doesn't have to ask which house. */}
      <section className="mt-10">
        <h2 className="font-mono text-[10px] uppercase tracking-wide text-clay">Capture</h2>
        <div className="mt-3 flex flex-wrap gap-3">
          <Link
            href={`/capture?type=invoice&entity=${entity}`}
            className="inline-flex items-center rounded-md border border-black/15 px-4 py-2 font-sans text-[13px] text-ink hover:border-ink/40"
          >
            + Capture invoice
          </Link>
          <Link
            href={`/capture?type=delivery_note&entity=${entity}`}
            className="inline-flex items-center rounded-md border border-black/15 px-4 py-2 font-sans text-[13px] text-ink hover:border-ink/40"
          >
            + Capture delivery note
          </Link>
        </div>
      </section>
    </main>
  );
}

export function generateMetadata({ params }: { params: { house: string } }) {
  return { title: `${houseNameForSlug(params.house)} · Food Studios` };
}
