import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";
import { getBindings } from "@/lib/integrations/registry";
import { frestoStatus, FRESTO_DRY_RUN } from "@/lib/integrations/pos/fresto";
import type { EntityCode } from "@/lib/integrations/types";
import PosSyncClient from "./PosSyncClient";
import AssistantContext from "@/components/AssistantContext";

export const dynamic = "force-dynamic";

// Universal POS sync history. Editorial identity — one table, filter chips, sync-now
// per row, and (later) a per-adapter widget slot.
//
// The page reads eod_pos + fresto_webhook_events to reconstruct "what did the POS say
// on this date, and where did the record come from" — so Boris can spot gaps at a glance.

const ENTITIES: EntityCode[] = ["IFL", "BM", "BBH"];
const LABEL: Record<EntityCode, string> = { IFL: "Ibiza Food Studios", BM: "Bistro Mondo", BBH: "Boris Buono Holdings" };
const RESTAURANT_ID_BY_ENTITY: Partial<Record<EntityCode, string>> = {
  IFL: "a0000000-0000-4000-8000-000000000001",
  BM:  "fb4d008f-2d2a-4e0d-a525-6e0e36af0259",
};

export default async function PosSyncPage({ searchParams }: { searchParams: { entity?: string } }) {
  const filter = (searchParams?.entity || "").toUpperCase() as EntityCode | "";
  const bindings = getBindings();
  const sb = supabaseServer();

  // Pull the last 30 days of eod_pos rows across the venues we know about,
  // then decorate with the most-recent webhook event per (venue,date) so the
  // history shows source of truth per row.
  const restaurantIds = Object.values(RESTAURANT_ID_BY_ENTITY).filter(Boolean) as string[];
  const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  const eodQ = sb.from("eod_pos")
    .select("id,restaurant_id,date,source,source_ref,total_gross_eur,imported_at,imported_by")
    .in("restaurant_id", restaurantIds)
    .gte("date", since)
    .order("date", { ascending: false });
  const eventsQ = sb.from("fresto_webhook_events")
    .select("id,entity_code,action,business_date,signature_verified,processed_ok,processed_error,received_at")
    .gte("received_at", new Date(Date.now() - 30 * 86400000).toISOString())
    .order("received_at", { ascending: false });

  const [{ data: eodRows }, { data: eventRows }] = await Promise.all([eodQ, eventsQ]);

  // Build (entity,date) → latest event for the row banner
  const evByKey = new Map<string, any>();
  for (const e of (eventRows || [])) {
    const key = `${e.entity_code}:${e.business_date || ""}`;
    if (!evByKey.has(key)) evByKey.set(key, e);
  }

  const rows = (eodRows || [])
    .map((r) => {
      const entity: EntityCode | null =
        r.restaurant_id === RESTAURANT_ID_BY_ENTITY.IFL ? "IFL" :
        r.restaurant_id === RESTAURANT_ID_BY_ENTITY.BM  ? "BM"  : null;
      const ev = entity ? evByKey.get(`${entity}:${r.date}`) : null;
      return { ...r, entity, event: ev };
    })
    .filter((r) => !filter || r.entity === filter);

  const chips: Array<{ label: string; href: string; active: boolean }> = [
    { label: "All", href: "/administrate/finance/pos-sync", active: !filter },
    ...ENTITIES.map((e) => ({ label: e, href: `/administrate/finance/pos-sync?entity=${e}`, active: filter === e })),
  ];

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <AssistantContext context={{ kind: "pos_sync", filter: filter || "ALL", rows_visible: rows.length, dry_run: FRESTO_DRY_RUN() }} />
      <Link href="/administrate/finance" className="font-mono text-[10px] uppercase tracking-wide text-clay">← finance</Link>
      <h1 className="mt-3 font-serif text-[34px] leading-[1.05] text-ink">POS sync</h1>
      <p className="mt-2 font-serif italic text-[14px] text-ink-soft">Every day, every venue, every source of truth. Immutable snapshots land in <code className="font-mono text-[12px] text-clay">eod_pos</code>; webhooks and manual pulls are just different couriers.</p>

      <nav className="mt-6 flex flex-wrap gap-2">
        {chips.map((c) => (
          <Link key={c.label} href={c.href} className={`rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-wide ${c.active ? "border-ink bg-ink text-paper" : "border-line bg-paper text-ink-soft"}`}>{c.label}</Link>
        ))}
      </nav>

      <section className="mt-6 rounded-2xl border border-line p-5">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Fresto — per-entity credentials</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {ENTITIES.map((e) => {
            const b = bindings.find((x) => x.entity === e);
            const st = frestoStatus(e);
            return (
              <div key={e} className="rounded-xl border border-line bg-paper p-4">
                <p className="font-mono text-[10px] uppercase tracking-wide text-clay">{e}</p>
                <p className="mt-1 font-serif text-[15px] text-ink">{LABEL[e]}</p>
                <p className="mt-1 font-mono text-[10px] text-muted">POS · {b?.pos?.vendor || "—"}</p>
                <StatusPill s={st} />
              </div>
            );
          })}
        </div>
        {FRESTO_DRY_RUN() ? <p className="mt-3 font-mono text-[10px] uppercase tracking-wide text-tomato">FS_FRESTO_DRY_RUN=true — pulls return empty shells (no API call)</p> : null}
      </section>

      <PosSyncClient
        rows={rows.map((r) => ({
          id: r.id, entity: (r.entity || "?") as string, date: r.date, source: r.source, source_ref: r.source_ref,
          total_gross_eur: Number(r.total_gross_eur || 0), imported_at: r.imported_at,
          event_action: r.event?.action || null,
          event_verified: r.event?.signature_verified === true,
          event_error: r.event?.processed_error || null,
        }))}
      />

      <section className="mt-8 rounded-2xl border border-line p-5">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Webhook endpoints</p>
        <p className="mt-2 font-serif italic text-[13px] text-muted">Paste these into Fresto for each venue. The <code className="font-mono text-[12px] text-clay">?entity=</code> query param is how we route the payload to the right venue on our side.</p>
        <dl className="mt-3 space-y-1.5 font-mono text-[11px] text-ink-soft">
          <div><dt className="text-muted">booking.approved</dt><dd className="text-ink">/api/integrations/fresto/webhook/booking-approved?entity=IFL|BM</dd></div>
          <div><dt className="text-muted">closing-report</dt><dd className="text-ink">/api/integrations/fresto/webhook/closing-report-submitted?entity=IFL|BM</dd></div>
        </dl>
        <p className="mt-3 font-mono text-[10px] uppercase tracking-wide text-clay">Signature</p>
        <p className="mt-1 font-serif italic text-[13px] text-muted">HMAC-SHA256 of the raw body, header <code className="font-mono text-[12px] text-clay">X-Fresto-Signature</code>. Secret: <code className="font-mono text-[12px] text-clay">FRESTO_WEBHOOK_SECRET</code>.</p>
      </section>
    </main>
  );
}

function StatusPill({ s }: { s: "connected" | "not-configured" }) {
  const c = s === "connected" ? "border-basil/40 bg-basil/10 text-basil" : "border-line bg-paper-deep text-muted";
  return <span className={`mt-2 inline-block rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide ${c}`}>{s === "connected" ? "live api" : "not configured"}</span>;
}
