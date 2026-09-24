import Link from "next/link";
import { redirect } from "next/navigation";
import { houseNameForSlug } from "@/lib/houses";
import { getHouseBySlug } from "@/lib/houses.server";
import { supabaseServer } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

// /h/<slug>/office/chef-log — every Chef turn for this house, newest first.
//
// Chef v3 P2 S6. Managers read it to see what the kitchen actually says to
// Chef, what it understood, and how often the operator had to say no (the
// wrong-action proxy). Same scope + auth pattern as ../inbox: the URL slug
// resolves the entity, the cookie-bound client reads through RLS (own rows +
// entity managers), so a cook sees their own turns and a manager the house.

type Turn = {
  id: string; user_id: string | null; route: string | null; transcript: string | null;
  intent: any; confidence: number | null; outcome: string | null; latency_ms: number | null;
  cost_cents: number | null; voice: boolean | null; language: string | null; created_at: string;
  source: string | null; chip_key: string | null; resolution: string | null; resolved_at: string | null;
  result: string | null;
};

const DAYS = [1, 7, 30] as const;
const LIMIT = 200;

function fmtTime(iso: string, tz: string): string {
  const d = new Date(iso);
  const hm = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  const dm = new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "2-digit", month: "2-digit" }).format(d);
  return `${hm} ${dm}`;
}

function intentLabel(intent: any): string {
  if (!intent || typeof intent !== "object") return "—";
  const kind = intent.kind ?? intent.type ?? intent.action ?? null;
  const tail = intent.surface ?? intent.q ?? intent.to ?? null;
  if (!kind) return "—";
  return tail ? `${kind} · ${String(tail).slice(0, 40)}` : String(kind);
}

// Resolution tone — tokens only. The "said no" family gets a hairline pill so
// it reads at a glance without colour.
function resolutionClass(r: string | null): string {
  switch (r) {
    case "undone": case "declined": case "timeout":
      return "inline-block rounded-full border border-line px-1.5 py-0.5 text-clay";
    case "edited":
      return "text-clay";
    case "confirmed_tap": case "confirmed_voice": case "done": case "chip":
      return "text-ink";
    default:
      return "text-ink-soft";
  }
}

function sourceLabel(t: Turn): string {
  const s = t.source ?? (t.voice ? "voice" : "typed");
  return s;
}

export default async function ChefLogPage({
  params, searchParams,
}: { params: { house: string }; searchParams?: { days?: string } }) {
  const slug = params.house;
  const house = await getHouseBySlug(slug);
  if (!house) redirect("/studio");
  const entity_id = house.id;
  const tz = house.timezone;

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user?.id) redirect(`/login?next=/h/${slug}/office/chef-log`);

  const daysRaw = Number(searchParams?.days ?? 7);
  const days: (typeof DAYS)[number] = (DAYS as readonly number[]).includes(daysRaw) ? (daysRaw as any) : 7;
  const since = new Date(Date.now() - days * 86400_000).toISOString();

  const { data: rows, error } = await sb
    .from("chef_turns")
    .select("id, user_id, route, transcript, intent, confidence, outcome, latency_ms, cost_cents, voice, language, created_at, source, chip_key, resolution, resolved_at, result")
    .eq("entity_id", entity_id)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(LIMIT);
  const turns = (rows ?? []) as Turn[];

  // Who — one second query on the distinct user_ids (chef_turns has no FK
  // PostgREST can follow into profiles here).
  const uids = Array.from(new Set(turns.map((t) => t.user_id).filter((x): x is string => !!x)));
  const names = new Map<string, string>();
  if (uids.length) {
    const { data: profs } = await sb.from("profiles").select("id, name").in("id", uids);
    for (const p of (profs ?? []) as any[]) names.set(p.id, p.name || "");
  }

  const n = turns.length;
  const voiceN = turns.filter((t) => t.voice || t.source === "voice" || t.source === "headset").length;
  const wrongN = turns.filter((t) => t.resolution === "undone" || t.resolution === "declined").length;
  const chipN = turns.filter((t) => t.source === "chip").length;
  const pct = (a: number) => (n ? Math.round((a / n) * 100) : 0);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Office · {houseNameForSlug(slug)}</p>
      <h1 className="mt-2 font-serif text-[34px] leading-tight text-ink">Chef log</h1>

      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-3 border-b border-line pb-3">
        <p className="font-mono text-[11px] text-ink-soft">
          {n}{n === LIMIT ? "+" : ""} turns · voice {pct(voiceN)}% · wrong-action {pct(wrongN)}% ({wrongN}) · chip taps {chipN}
          {error ? <span className="ml-2 text-clay">· {error.message}</span> : null}
        </p>
        <nav className="flex gap-1 font-mono text-[10px] uppercase tracking-wide" aria-label="Range">
          {DAYS.map((d) => (
            <Link
              key={d}
              href={`/h/${slug}/office/chef-log?days=${d}`}
              className={"rounded-full px-2.5 py-0.5 " + (d === days ? "bg-ink text-paper" : "text-clay hover:text-ink")}
              aria-current={d === days ? "page" : undefined}
            >
              {d === 1 ? "24h" : `${d}d`}
            </Link>
          ))}
        </nav>
      </div>

      {n === 0 ? (
        <p className="mt-8 font-serif italic text-[15px] text-ink-soft">No turns in this window.</p>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="font-mono text-[10px] uppercase tracking-wide text-clay">
                {["Time", "Who", "Src", "Transcript", "Intent", "Conf", "Outcome", "Resolution", "Result", "ms", "¢"].map((h) => (
                  <th key={h} className="border-b border-line py-2 pr-3 text-left font-normal">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {turns.map((t) => (
                <tr key={t.id} className="border-b border-line/60 align-top">
                  <td className="whitespace-nowrap py-2 pr-3 font-mono text-[11px] text-ink-soft">{fmtTime(t.created_at, tz)}</td>
                  <td className="whitespace-nowrap py-2 pr-3 text-ink">{(t.user_id && names.get(t.user_id)) || (t.user_id ? t.user_id.slice(0, 8) : "—")}</td>
                  <td className="py-2 pr-3">
                    <span className="inline-block rounded-full border border-line px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-ink-soft">{sourceLabel(t)}</span>
                  </td>
                  <td className="max-w-[22rem] py-2 pr-3 text-ink">{t.transcript || (t.chip_key ? <span className="font-mono text-ink-soft">#{t.chip_key}</span> : "—")}</td>
                  <td className="max-w-[14rem] py-2 pr-3 font-mono text-[11px] text-ink-soft">{intentLabel(t.intent)}</td>
                  <td className="py-2 pr-3 font-mono text-[11px] text-ink-soft">{t.confidence == null ? "—" : t.confidence.toFixed(2)}</td>
                  <td className="py-2 pr-3 font-mono text-[11px] text-ink-soft">{t.outcome ?? "—"}</td>
                  <td className="whitespace-nowrap py-2 pr-3 font-mono text-[10px]"><span className={resolutionClass(t.resolution)}>{t.resolution ?? "—"}</span></td>
                  <td className="max-w-[16rem] py-2 pr-3 text-ink-soft">{t.result ?? "—"}</td>
                  <td className="py-2 pr-3 text-right font-mono text-[11px] text-ink-soft">{t.latency_ms ?? "—"}</td>
                  <td className="py-2 text-right font-mono text-[11px] text-ink-soft">{t.cost_cents ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
