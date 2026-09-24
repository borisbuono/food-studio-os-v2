"use client";

// ChefCard — the ONE result surface of Chef v3 (brief §3).
//
// ≤ 4 lines, one primary button, at most one chip, an entity chip. Reads
// never navigate by themselves: tapping the card body (or the primary)
// does. A confirm card is the read-back with big Yes / No; an undoable
// write shows Undo for 10 s. Type is 17 px minimum — readable at arm's
// length with wet hands (brief §1). No close button anywhere: the card
// dissolves on its own or on the next turn.

import type { ChefCard as CardT, ChefCardAction } from "@/lib/chef/types";
import { t } from "@/lib/i18n";

export type ChefCardProps = {
  card: CardT;
  transcript?: string | null;
  readback?: string | null;
  mode: "result" | "confirm" | "error";
  hint?: string | null;            // Phase 2: "Say yes or no, or tap" / "Tap Yes to confirm"
  listening?: boolean;             // Phase 2: the yes/no voice window is open
  undoLeftMs?: number | null;      // > 0 while Undo is offered
  busy?: boolean;
  onPrimary?: (a: ChefCardAction) => void;
  onChip?: (a: ChefCardAction) => void;
  onBody?: () => void;
  onYes?: () => void;
  onNo?: () => void;
  onUndo?: () => void;
};

export default function ChefCard(p: ChefCardProps) {
  const { card } = p;
  const lines = (card.lines || []).slice(0, 4);
  const tappable = !!card.href && p.mode === "result";
  return (
    <div
      role={p.mode === "confirm" ? "alertdialog" : "status"}
      aria-live="polite"
      className={
        "w-full rounded-2xl border bg-paper shadow-lg " +
        (p.mode === "confirm" ? "border-ink" : p.mode === "error" ? "border-tomato" : "border-line")
      }
      data-chef-card={p.mode}
    >
      {p.transcript ? (
        <p className="border-b border-line px-4 pt-3 pb-2 font-mono text-[13px] leading-snug text-clay">
          <span className="uppercase tracking-wide">{t("chef.heard")}</span>{" "}
          <span className="text-ink-soft">{p.transcript}</span>
        </p>
      ) : null}

      <div
        className={"px-4 py-3 " + (tappable ? "cursor-pointer active:bg-paper-deep" : "")}
        onClick={tappable ? p.onBody : undefined}
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-serif text-[20px] leading-tight text-ink">{card.title}</h3>
          {card.entity_label ? (
            <span
              className="mt-0.5 shrink-0 rounded-full px-2 py-0.5 font-mono text-[11px] uppercase tracking-wide text-paper"
              style={{ background: "var(--accent)" }}
            >
              {card.entity_label}
            </span>
          ) : null}
        </div>
        {p.mode === "confirm" && p.readback ? (
          <p className="mt-2 font-sans text-[17px] leading-snug text-ink">{p.readback}</p>
        ) : null}
        {p.mode === "confirm" && p.hint ? (
          <p className="mt-2 flex items-center gap-2 font-mono text-[12px] uppercase tracking-wide text-clay">
            {p.listening ? <span aria-hidden className="inline-block h-2.5 w-2.5 animate-pulse rounded-full" style={{ background: "var(--accent)" }} /> : null}
            {p.hint}
          </p>
        ) : null}
        {lines.length ? (
          <ul className="mt-2 space-y-1">
            {lines.map((l, i) => (
              <li key={i} className="font-sans text-[17px] leading-snug text-ink-soft">{l}</li>
            ))}
          </ul>
        ) : null}
      </div>

      {/* Actions row */}
      {p.mode === "confirm" ? (
        <div className="flex gap-2 border-t border-line p-3">
          <button
            type="button"
            onClick={p.onNo}
            disabled={p.busy}
            className="h-14 flex-1 rounded-xl border border-line font-sans text-[17px] text-ink active:bg-paper-deep disabled:opacity-40"
          >
            {t("chef.no")}
          </button>
          <button
            type="button"
            onClick={p.onYes}
            disabled={p.busy}
            className="h-14 flex-[2] rounded-xl font-sans text-[17px] font-medium text-paper active:brightness-90 disabled:opacity-40"
            style={{ background: "var(--accent)" }}
          >
            {p.busy ? "…" : t("chef.yes")}
          </button>
        </div>
      ) : card.primary || card.chip || card.secondary || (p.undoLeftMs && p.undoLeftMs > 0) ? (
        <div className="flex items-center gap-2 border-t border-line p-3">
          {p.undoLeftMs && p.undoLeftMs > 0 ? (
            <button
              type="button"
              onClick={p.onUndo}
              className="h-12 rounded-xl border border-ink px-4 font-sans text-[17px] text-ink active:bg-paper-deep"
            >
              {t("chef.undo")} · {Math.ceil(p.undoLeftMs / 1000)}
            </button>
          ) : null}
          {card.chip ? (
            <button
              type="button"
              onClick={() => p.onChip?.(card.chip!)}
              className="h-12 rounded-full border border-line px-4 font-sans text-[15px] text-ink-soft active:bg-paper-deep"
            >
              {card.chip.label}
            </button>
          ) : null}
          {card.secondary ? (
            <button
              type="button"
              onClick={() => p.onChip?.(card.secondary!)}
              className="h-12 rounded-full border border-line px-4 font-sans text-[15px] text-ink-soft active:bg-paper-deep"
            >
              {card.secondary.label}
            </button>
          ) : null}
          <span className="flex-1" />
          {card.primary ? (
            <button
              type="button"
              onClick={() => p.onPrimary?.(card.primary!)}
              disabled={p.busy}
              className="h-12 rounded-xl px-5 font-sans text-[17px] font-medium text-paper active:brightness-90 disabled:opacity-40"
              style={{ background: "var(--accent)" }}
            >
              {card.primary.label}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
