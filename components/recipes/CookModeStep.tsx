// The dark-amber Cook Mode step — 44px serif body, mono eyebrow with the
// recipe name, progress dot strip, timer + heat + next-action meta row.
// Used by the CookMode container to render one step at a time.
type Meta = { timer?: string | null; heat?: string | null; next?: string | null };

export default function CookModeStep({
  recipeName,
  stepIndex,
  stepCount,
  body,
  meta,
  swipeHint,
}: {
  recipeName: string;
  stepIndex: number;
  stepCount: number;
  body: string;
  meta?: Meta;
  swipeHint?: string;
}) {
  const stepLabel = `Step ${stepIndex + 1} of ${stepCount}`;
  return (
    <div className="min-h-[80vh] bg-night px-10 pb-20 pt-14 text-night-ink">
      <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.15em] text-amber">{recipeName} · Cook Mode</p>
      <p className="mb-8 font-mono text-[14px] uppercase tracking-[0.1em] text-amber">{stepLabel}</p>
      <p className="mb-14 max-w-[780px] font-serif text-[44px] font-normal leading-[1.25] tracking-[-0.6px] text-night-ink">{body}</p>

      {meta && (meta.timer || meta.heat || meta.next) ? (
        <div className="flex flex-wrap gap-10 font-mono text-[11px] uppercase tracking-[0.1em] text-night-ink/50">
          {meta.timer ? <span className="text-amber">{meta.timer}</span> : null}
          {meta.heat ? <span>heat: {meta.heat}</span> : null}
          {meta.next ? <span>next: {meta.next}</span> : null}
        </div>
      ) : null}

      <div className="mt-20 flex items-center gap-5 border-t border-night-ink/15 pt-10">
        <div className="flex flex-1 gap-1">
          {Array.from({ length: stepCount }).map((_, k) => {
            const cls = k < stepIndex ? "bg-amber" : k === stepIndex ? "bg-amber/50" : "bg-night-ink/15";
            return <span key={k} className={`h-0.5 flex-1 ${cls}`} />;
          })}
        </div>
        {swipeHint ? <span className="font-serif italic text-[15px] text-night-ink/50">{swipeHint}</span> : null}
      </div>
    </div>
  );
}
