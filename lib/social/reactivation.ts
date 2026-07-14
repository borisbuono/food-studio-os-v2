// Reactivation-checklist shape. Single source of truth for the Ads page,
// the /api/grow/reach/ads/reactivation writer, and the Chef FAB summariser.
//
// The BM Meta ad account has been disabled since 2026-04-04 for payment
// method failure. To turn it back on Boris needs to work through a small
// number of prerequisites — each one has a step_key, a human label, and a
// hint pointing at where the actual work lives (draft email, task, Meta
// dashboard, etc.). The checklist state lives in platform_reactivation_state.

export type ReactivationStep = { key: string; label: string; hint: string };

export const REACTIVATION_STEPS: ReactivationStep[] = [
  { key: "card_rotated",     label: "Card rotated",        hint: "Payment method 2134 was failing across the estate. New card added to Meta Billing." },
  { key: "campaigns_audited", label: "Campaigns audited",   hint: "Every paused / archived campaign reviewed. Nothing wasteful is queued to resume." },
  { key: "creative_refreshed", label: "Creative refreshed", hint: "New creative set uploaded (image or reel). Old asset library archived." },
  { key: "budget_set",       label: "Budget set",          hint: "Daily / lifetime budget defined + confirmed with Boris before we go live." },
];

export function computeReadiness(rows: Array<{ step_key: string; done: boolean }>) {
  const map = new Map(rows.map((r) => [r.step_key, r.done]));
  let done = 0;
  for (const s of REACTIVATION_STEPS) if (map.get(s.key)) done++;
  return { done, total: REACTIVATION_STEPS.length, ready: done === REACTIVATION_STEPS.length };
}
