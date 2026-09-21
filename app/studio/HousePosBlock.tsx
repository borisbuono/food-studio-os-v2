import { GuestChip } from "./GuestChip";
import { HourlySpark } from "./HourlySpark";
import type { PosSnap } from "@/lib/studio/houseSnapshots.server";
import { lastCloseLabel, isStaleClose } from "@/lib/studio/closeStatus";

// The POS half of a house tile — shared by /studio and /studio/houses so the
// two surfaces can't drift again (task #58). Line 1 money · tickets · guests;
// line 2 "Last close DD MMM" + SPAN / STALE pills; optional hourly spark.
//
// tickets = Fresto z.quantity (items), guests = physical people (Boris rule
// 2026-08-31 18:15 CET — never conflate).

function eur(n: number): string {
  return "€" + Math.round(n).toLocaleString("en-GB");
}

const PILL_STYLE = { borderColor: "#B85C1E66", color: "#B85C1E", background: "#B85C1E14" };

export function HousePosBlock({
  pos, restaurantId, today,
}: { pos: PosSnap | null; restaurantId: string | null; today: string }) {
  if (!pos) {
    return <p className="mt-3 font-sans text-[13px] text-ink-soft">No closes yet</p>;
  }
  const stale = isStaleClose(pos.date, today);
  const guests = pos.guests_daily ?? pos.guests ?? null;
  return (
    <>
      <p className="mt-3 font-sans text-[13px] text-ink-soft">
        {eur(pos.gross)}
        {pos.tickets != null ? <span> · {pos.tickets} tickets</span> : null}
        {guests != null ? <span> · {guests} guests</span> : null}
      </p>
      {pos.guests_daily == null && restaurantId ? (
        <div className="mt-2">
          <GuestChip
            restaurant_id={restaurantId}
            date={pos.date}
            initialGuests={pos.guests ?? null}
            initialSource={pos.guests_source ?? null}
          />
        </div>
      ) : null}
      <p className="mt-2 flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-wide text-clay">
        <span data-testid="last-close">{lastCloseLabel(pos.date)}</span>
        {pos.peak_hour ? (
          <span title="Peak revenue hour">
            · peak {pos.peak_hour}:00
            {pos.peak_hour_revenue ? ` (${eur(pos.peak_hour_revenue)})` : null}
          </span>
        ) : null}
        {pos.z_spans_days ? (
          <span
            className="inline-flex items-center rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide"
            style={PILL_STYLE}
            title="Z-report spans multiple days; cash figures on this row are aggregated and unreliable"
          >
            Span
          </span>
        ) : null}
        {stale ? (
          <span
            data-testid="stale-badge"
            className="inline-flex items-center rounded-full border px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wide"
            style={PILL_STYLE}
            title="Newest close is more than 48h old"
          >
            Stale
          </span>
        ) : null}
      </p>
      {pos.hourly_revenue ? (
        <div className="mt-2 hidden sm:block" aria-hidden="true" title="Hourly revenue — 07..22, peak hour in ink">
          <HourlySpark hourly={pos.hourly_revenue} peakHour={pos.peak_hour} />
        </div>
      ) : null}
    </>
  );
}
