// Prose-styled steps — 17px Fraunces, 1.8 line-height, ordinal labels in
// mono uppercase and accent-colored (ONE / TWO / THREE). Optional italic aside
// blocks quoted with a hairline-left in the accent colour, positioned by index.
type Step = { text: string; aside?: string | null };

const WORDS = [
  "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT",
  "NINE", "TEN", "ELEVEN", "TWELVE", "THIRTEEN", "FOURTEEN", "FIFTEEN",
  "SIXTEEN", "SEVENTEEN", "EIGHTEEN", "NINETEEN", "TWENTY",
];

export default function StepsProse({ steps, accent }: { steps: Step[] | string[]; accent?: string }) {
  const acc = accent || "var(--fs-accent, #9A3122)";
  if (!steps?.length) {
    return <p className="font-serif italic text-[15px] text-clay">No method recorded yet.</p>;
  }
  const normalised: Step[] = steps.map((s) => (typeof s === "string" ? { text: s } : s));

  return (
    <div className="font-serif text-[17px] leading-[1.8] text-ink-soft">
      {normalised.map((s, k) => (
        <div key={k}>
          <p className="relative mb-5 pl-9">
            <span
              className="absolute left-0 top-2 font-mono text-[10px] tracking-[0.08em]"
              style={{ color: acc }}
            >
              {WORDS[k] || String(k + 1)}
            </span>
            <span>{s.text}</span>
          </p>
          {s.aside ? (
            <div
              className="my-6 border-l-2 pl-5 font-serif italic text-[15px] leading-[1.6] text-clay"
              style={{ borderColor: acc }}
            >
              {s.aside}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
