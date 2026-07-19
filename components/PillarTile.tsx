import Link from "next/link";
import type { Flow } from "@/lib/routing/pillar-map";
import { FLOW_LABEL } from "@/lib/routing/pillar-map";

// Architecture v2 → Pillars — the consistent tile pattern.
// Each tile: kicker · one big number · one sentence · primary action.
// A small "flow" chip preserves the temporal semantics (develop/execute/
// admin/grow) even though the top nav now shows the three pillars instead.
// Visual: hairline top border, editorial typography, per-venue accent.

const FLOW_CHIP_CLASS: Record<Flow, string> = {
  develop: "border-black/15 text-ink-soft",
  execute: "border-tomato/40 text-tomato",
  admin: "border-basil/40 text-basil",
  grow: "border-[#0E7C86]/40 text-[#0E7C86]",
};

export function FlowChip({ flow, className = "" }: { flow: Flow; className?: string }) {
  const cls = FLOW_CHIP_CLASS[flow];
  return (
    <span
      className={"inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wide " + cls + " " + className}
      title={FLOW_LABEL[flow] + " · temporal flow"}
    >
      {FLOW_LABEL[flow]}
    </span>
  );
}

export function PillarTile({
  href,
  kicker,
  title,
  value,
  status,
  action = "Open →",
  flowChip,
}: {
  href: string;
  kicker: string;
  title: string;
  value: string | number;
  status: string;
  action?: string;
  flowChip?: Flow;
}) {
  return (
    <Link href={href} className="group block border-t border-line py-6 transition hover:opacity-80">
      <div className="flex items-center gap-2">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">{kicker}</p>
        {flowChip ? <FlowChip flow={flowChip} /> : null}
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-4">
        <h2 className="font-serif text-2xl text-ink">{title}</h2>
        <span className="font-serif text-3xl leading-none text-ink">{value}</span>
      </div>
      <p className="mt-2 font-serif italic text-[14px] text-ink-soft">{status}</p>
      <p className="mt-3 font-mono text-[10px] uppercase tracking-wide" style={{ color: "var(--accent)" }}>{action}</p>
    </Link>
  );
}

export function PillarHeader({ kicker, title, blurb, back = "/" }: { kicker: string; title: string; blurb: string; back?: string }) {
  return (
    <>
      <Link href={back} className="font-sans text-sm text-ink-soft">{back === "/" ? "← home" : "← back"}</Link>
      <p className="mt-6 font-mono text-[10px] uppercase tracking-wide" style={{ color: "var(--accent)" }}>{kicker}</p>
      <h1 className="mt-2 font-serif text-4xl leading-tight text-ink">{title}</h1>
      <p className="mt-2 font-serif italic text-[15px] text-ink-soft">{blurb}</p>
    </>
  );
}
