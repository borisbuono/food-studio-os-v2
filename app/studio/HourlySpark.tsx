// Ink-black hairline sparkline of a day's hourly revenue.
//
// Boris walk 2026-09-09: the Studio tiles show today's number as a
// scalar. A tiny bar plot of `hourly_revenue` under the numbers gives
// him the shape of the day at a glance — was it a lunch day, a dinner
// day, one push, or two — without a click.
//
// Constraints:
//   - unobtrusive (ink hairlines, no colour, height ~18px)
//   - 16 bars covering 07..22 (opening hours) — hours outside the range
//     get folded into the nearest edge so a stray late-night bar still
//     shows
//   - peak-hour bar rendered a hair thicker for orientation
//
// Renders nothing when hourly is empty (a day with no orderline
// timestamps) — the tile falls back to the flat numbers.

type Props = {
  hourly: Record<string, number> | null | undefined;
  peakHour?: string | null;
  className?: string;
};

const HOURS = ["07","08","09","10","11","12","13","14","15","16","17","18","19","20","21","22"];

export function HourlySpark({ hourly, peakHour, className = "" }: Props) {
  if (!hourly || Object.keys(hourly).length === 0) return null;

  const values = HOURS.map((h) => Number(hourly[h] || 0));
  // Fold anything outside 07..22 into the nearest edge so a 23:xx close
  // still contributes to the last bar rather than disappearing.
  for (const [k, v] of Object.entries(hourly)) {
    const n = parseInt(k, 10);
    if (isNaN(n)) continue;
    if (n < 7)  values[0]  += Number(v || 0);
    if (n > 22) values[values.length - 1] += Number(v || 0);
  }

  const max = Math.max(1, ...values);
  const barW = 4;
  const gap = 1;
  const h = 18;
  const w = HOURS.length * (barW + gap);

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className={className}
      aria-hidden="true"
    >
      {values.map((v, i) => {
        const barH = Math.max(1, Math.round((v / max) * (h - 1)));
        const y = h - barH;
        const isPeak = peakHour && HOURS[i] === peakHour;
        return (
          <rect
            key={i}
            x={i * (barW + gap)}
            y={y}
            width={barW - (isPeak ? 0 : 0.5)}
            height={barH}
            fill={isPeak ? "#111" : "#111"}
            opacity={isPeak ? 1 : 0.45}
          />
        );
      })}
    </svg>
  );
}
