"use client";

// ChefChips — Phase 2 S4 stub. Predictive idle chips (2–3) live INSIDE the
// Chef dock band, flanking the control on the phone, above it on desktop.
// Filled in by the S4 slice; this stub renders nothing so the control ships
// unchanged until then.

export type ChefChip = { key: string; label: string; utterance: string };

export default function ChefChips(_p: { entityId: string; route: string; lang: "es" | "en"; desktop: boolean; visible: boolean; onPick: (c: ChefChip) => void }) {
  return null;
}
