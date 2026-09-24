// One z-scale for the app shell (Chef Option A, 2026-09-24).
//
// Before this file the shell carried nine ad-hoc values (30/40/50/59/60/70/
// 70/70/80) with no shared rule, which is how the Chef FAB (60) ended up
// painted over the Chef drawer's own composer (50). Every fixed / sticky
// element mounted from app/layout.tsx or AppChrome takes its z from here,
// via `style={{ zIndex: Z.x }}` (inline, not a Tailwind class, so the
// constant is the single source and JIT can't miss a dynamic class).
//
// Order, low → high:
//   base    page content
//   sticky  sidebar, top bars (sticky chrome)
//   drawer  Chef drawer, side panels, the new-hire nudge card
//   fab     the Chef circle — above the drawer so it can be its Close
//   modal   CommandK, keyboard help, Chef's capture house-picker
//   toast   offline badge, toasts — above everything
//
// Page-local overlays (calendar, inbox, prep bar…) may keep their own
// values as long as they stay below `drawer`.
export const Z = {
  base: 0,
  sticky: 30,
  drawer: 50,
  fab: 60,
  modal: 70,
  toast: 80,
} as const;

export type ZLevel = keyof typeof Z;
