// /onboard — dispatcher.
//
// Read the user's onboarding_state and forward them to the right step so
// mid-wizard refreshes and stale bookmarks always land on the current
// step, not step 1. Anon users go to step 1 (which handles sign-in).

import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabaseServer";
import { readOnboardingState } from "@/lib/onboarding";

export const dynamic = "force-dynamic";

export default async function OnboardIndex() {
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) redirect("/onboard/step-1");
  const state = await readOnboardingState();
  const step = state.step ?? 2;
  const clamped = Math.min(Math.max(step, 2), 5);
  redirect(`/onboard/step-${clamped}`);
}
