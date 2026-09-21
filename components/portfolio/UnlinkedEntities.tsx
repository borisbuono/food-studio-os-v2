import { Pill, SectionTitle } from "./PortfolioChrome";

// Live mode only: entities of this type that have no contract on file yet,
// so the portfolio view is never silently missing a counterparty.
export function UnlinkedEntities({
  entities, label,
}: { entities: { id: string; name: string; status: string | null }[]; label: string }) {
  if (!entities.length) return null;
  return (
    <>
      <SectionTitle>{label} · no contract on file</SectionTitle>
      <ul className="mt-3 flex flex-wrap gap-2">
        {entities.map((e) => (
          <li key={e.id} className="flex items-center gap-2 rounded-full border border-line px-3 py-1 font-sans text-[13px] text-ink-soft">
            {e.name}
            {e.status && e.status !== "active" ? <Pill tone="muted">{e.status}</Pill> : null}
          </li>
        ))}
      </ul>
    </>
  );
}
