// /onboard/step-1 — sign in / sign up.
//
// If the visitor is already authed, jump straight to step 2. Otherwise
// show the familiar magic-link + Google surface. Keeps step 1 the ONE
// bookmark you can share with a new customer.

import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabaseServer";
import { OnboardShell } from "@/components/OnboardShell";
import OnboardStep1Auth from "./OnboardStep1Auth";

export const dynamic = "force-dynamic";

export default async function OnboardStep1() {
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (u.user) redirect("/onboard/step-2");
  return (
    <OnboardShell
      step={1}
      eyebrow="Welcome"
      title="Let's set up your house."
      sub="Five short steps. You can pause any time — everything you enter is saved. First, a sign-in link so we know it's you."
    >
      <OnboardStep1Auth />
    </OnboardShell>
  );
}
