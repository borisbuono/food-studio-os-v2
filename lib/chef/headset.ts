"use client";

// Phase 2 S5 stub — headset / media-key push-to-talk for the wall screen at
// the pass (/h/[house]/pass). Filled in by the S5 slice. The hook is wired
// into ChefRoot already so the slice only has to implement it.
export function useHeadsetPTT(_enabled: boolean, _onToggle: () => void): { supported: boolean } {
  return { supported: false };
}
