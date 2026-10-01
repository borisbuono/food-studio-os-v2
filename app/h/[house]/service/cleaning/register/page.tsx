import Link from "next/link";
import { redirect } from "next/navigation";
import { houseNameForSlug } from "@/lib/houses";
import { getHouseBySlug } from "@/lib/houses.server";
import { supabaseServer } from "@/lib/supabaseServer";
import { verbWord } from "@/lib/nav/labels";
import { serverLang, tServer } from "@/lib/i18nServer";
import { loadRuns, tzToday } from "@/lib/cleaning/server";
import { dmy, hhmm, monthBounds, monthLabel, shiftMonth } from "@/lib/cleaning/register";
import type { CleaningRun } from "@/lib/cleaning/types";

// /h/<slug>/service/cleaning/register — the month's record (cleaning S3).
// One row per run: date · list · done/total · signed by · time; filter by
// area; each row opens (plain <details>) to the lines with who and when.
// "Export month" → /api/cleaning/export, one black-and-white PDF.
// Server-rendered on purpose: inspection on a phone, nothing to load.
export const dynamic = "force-dynamic";

export default async function CleaningRegisterPage({ params, searchParams }: { params: { house: string }; searchParams?: { month?: string; area?: string } }) {
  const house = await getHouseBySlug(params.house);
  if (!house) redirect("/studio");
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user?.id) redirect("/login?next=" + encodeURIComponent(`/h/${params.house}/service/cleaning/register`));
  const lang = serverLang();
  const t = (k: string) => tServer(k, lang);
  const today = tzToday(house.timezone);
  const month = monthBounds(searchParams?.month || "") ? String(searchParams!.month) : today.slice(0, 7);
  const area = searchParams?.area || null;
  const b = monthBounds(month)!;
  let runs: CleaningRun[] = [];
  let error: string | null = null;
  try { runs = await loadRuns(sb, house.id, b.from, b.to, { area }); } catch (e: any) { error = String(e?.message || e); }
  // areas for the filter come from the whole month, unfiltered
  let areas: string[] = [];
  try { const all = area ? await loadRuns(sb, house.id, b.from, b.to) : runs; areas = Array.from(new Set(all.map((r) => r.area).filter(Boolean) as string[])).sort(); } catch { /* keep empty */ }
  const base = `/h/${params.house}/service/cleaning/register`;
  const q = (m: string, a: string | null) => `${base}?month=${m}${a ? `&area=${encodeURIComponent(a)}` : ""}`;
  const exportHref = `/api/cleaning/export?entity=${house.id}&month=${month}${area ? `&area=${encodeURIComponent(area)}` : ""}`;
  const signed = runs.filter((r) => r.status === "signed").length;

  return (
    <div>
      <div className="mx-auto max-w-xl px-4 pt-8 lg:max-w-4xl">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-clay">{houseNameForSlug(params.house)} · {verbWord("serve", lang)} · <Link href={`/h/${params.house}/service/cleaning`} className="underline-offset-4 hover:underline">{t("cleaning.title")}</Link></p>
        <h1 className="mt-1 font-serif text-3xl text-ink">{t("cleaning.register")}</h1>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Link href={q(shiftMonth(month, -1), area)} aria-label="previous month" className="grid h-11 w-11 place-items-center rounded-xl border border-line text-ink">‹</Link>
          <p className="min-w-[10rem] text-center font-serif text-[20px] capitalize text-ink">{monthLabel(month, lang)}</p>
          <Link href={q(shiftMonth(month, 1), area)} aria-label="next month" className="grid h-11 w-11 place-items-center rounded-xl border border-line text-ink">›</Link>
          <a href={exportHref} className="ml-auto inline-flex min-h-[44px] items-center rounded-xl bg-ink px-4 font-mono text-[12px] uppercase tracking-wide text-paper">{t("cleaning.export")}</a>
        </div>

        {areas.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href={q(month, null)} className={"min-h-[40px] inline-flex items-center rounded-lg border px-3 font-mono text-[12px] " + (!area ? "border-ink bg-ink text-paper" : "border-line text-ink")}>{t("cleaning.area_all")}</Link>
            {areas.map((a) => <Link key={a} href={q(month, a)} className={"min-h-[40px] inline-flex items-center rounded-lg border px-3 font-mono text-[12px] " + (area === a ? "border-ink bg-ink text-paper" : "border-line text-ink")}>{a}</Link>)}
          </div>
        ) : null}

        <p className="mt-4 font-mono text-[12px] uppercase tracking-wide text-clay">{runs.length} · {signed} {t("cleaning.signed").toLowerCase()}</p>
        {error ? <p role="alert" className="mt-3 text-tomato">{error}</p> : null}
        {!runs.length && !error ? <p className="mt-4 text-ink-soft">{t("cleaning.register_empty")}</p> : null}

        <div className="mt-3 overflow-hidden rounded-2xl border border-line">
          <div className="hidden grid-cols-[6rem_1fr_6rem_10rem_4rem] gap-2 border-b border-line bg-paper-deep px-4 py-2 font-mono text-[11px] uppercase tracking-wide text-clay md:grid">
            <span>{t("cleaning.col.date")}</span><span>{t("cleaning.col.list")}</span><span>{t("cleaning.col.items")}</span><span>{t("cleaning.col.signed")}</span><span>{t("cleaning.col.time")}</span>
          </div>
          {runs.map((r) => {
            const done = r.items.filter((i) => i.done).length;
            const out = r.items.some((i) => i.kind === "temp" && i.in_range === false);
            return (
              <details key={r.id} className="group border-b border-line-soft last:border-b-0">
                <summary className="grid cursor-pointer list-none grid-cols-[5rem_1fr] gap-x-3 gap-y-1 px-4 py-3 md:grid-cols-[6rem_1fr_6rem_10rem_4rem] md:gap-2 md:items-baseline">
                  <span className="font-mono text-[13px] tabular-nums text-ink">{dmy(r.service_date).slice(0, 5)}</span>
                  <span className="text-[15px] text-ink">{r.template_name}{r.area ? <span className="text-clay"> · {r.area}</span> : null}{out ? <span className="ml-2 font-mono text-[11px] uppercase text-tomato">{t("cleaning.temp_out")}</span> : null}</span>
                  <span className="font-mono text-[13px] tabular-nums text-ink-soft">{done} / {r.items.length}</span>
                  <span className={"text-[13px] " + (r.status === "signed" ? "text-ink" : "text-clay")}>{r.status === "signed" ? r.signed_by_name : t("cleaning.unsigned")}</span>
                  <span className="font-mono text-[13px] tabular-nums text-ink-soft">{r.status === "signed" ? hhmm(r.signed_at, house.timezone) : ""}</span>
                </summary>
                <ul className="divide-y divide-line-soft border-t border-line-soft bg-paper-deep/40 px-4">
                  {r.items.map((i) => (
                    <li key={i.id} className="flex items-start gap-3 py-2 text-[14px]">
                      <span aria-hidden className={"mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded border text-[12px] " + (i.done ? "border-ink bg-ink text-paper" : "border-clay")}>{i.done ? "✓" : ""}</span>
                      <span className="min-w-0 flex-1">
                        <span className={i.in_range === false ? "text-tomato" : "text-ink"}>{i.kind === "corrective" ? `${t("cleaning.corrective")} — ` : ""}{i.label}{i.kind === "temp" && i.temperature_c != null ? ` · ${i.temperature_c} °C` : ""}</span>
                        {i.done ? <span className="block font-mono text-[11px] text-clay">{t("cleaning.by")} {i.done_by_name} · {hhmm(i.done_at, house.timezone)}</span> : null}
                        {i.note ? <span className="block text-[13px] italic text-ink-soft">“{i.note}”</span> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function generateMetadata({ params }: { params: { house: string } }) {
  return { title: `${houseNameForSlug(params.house)} · Service · Cleaning register · Food Studios` };
}
