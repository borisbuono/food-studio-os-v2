"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { getMyProfile } from "@/lib/profile";

// Companion piece to the Assistant FAB.
//
// On new-hire day (defined as: an accepted team_invitations row from today
// AND the system_walked onboarding_step not yet done), a soft pill appears
// above the FAB — "Chef here. Walk you through it?" — that hands off to the
// person's training path.
//
// Kept out of AssistantFab itself so the FAB's complex speech/session
// lifecycle stays untouched. The pill sits above the FAB at the same
// bottom-right anchor; dismissing it stashes a same-day flag so it does not
// re-appear until tomorrow.

type State = "hidden" | "showing" | "dismissed";

export default function NewHireAssistantNudge() {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<State>("hidden");
  const [userId, setUserId] = useState<string | null>(null);
  const [fabHidden, setFabHidden] = useState(false);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const check = () => setFabHidden(document.body.getAttribute("data-fab") === "hidden");
    check();
    const mo = new MutationObserver(check);
    mo.observe(document.body, { attributes: true, attributeFilter: ["data-fab"] });
    return () => mo.disconnect();
  }, [pathname]);

  useEffect(() => {
    (async () => {
      const me = await getMyProfile();
      if (!me) return;
      setUserId(me.id);
      // Only show on the home page (the compass) and the trainee's own
      // training page — everywhere else, the FAB is enough.
      if (pathname !== "/" && !pathname?.endsWith("/training")) return;

      const today = new Date().toISOString().slice(0, 10);
      // Same-day dismissal — don't nag.
      if (localStorage.getItem("fs_newhire_nudge_dismissed_" + today) === "1") return;

      // Is this user a new hire whose system_walked hasn't been marked yet?
      const email = (me.email || "").toLowerCase();
      if (!email) return;

      const { data: inv } = await supabaseBrowser
        .from("team_invitations")
        .select("accepted_at,starting_date,role")
        .eq("invited_email", email)
        .not("accepted_at", "is", null)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (!inv) return;

      // Started within the last 7 days (or starting today).
      const startMs = inv.starting_date ? new Date(inv.starting_date + "T00:00:00").getTime() : new Date(inv.accepted_at as string).getTime();
      const daysAgo = (Date.now() - startMs) / (24 * 3600 * 1000);
      if (daysAgo > 7 || daysAgo < -1) return;

      const { data: walked } = await supabaseBrowser
        .from("onboarding_steps").select("done_at")
        .eq("user_id", me.id).eq("step_key", "system_walked").maybeSingle();
      if (walked?.done_at) return;

      setState("showing");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  if (state !== "showing" || fabHidden || !userId) return null;

  return (
    <div className="fixed bottom-24 right-5 z-[59] max-w-[280px] rounded-2xl border border-line bg-card p-4 shadow-lg shadow-black/10 animate-in fade-in slide-in-from-bottom-2">
      <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Chef</p>
      <p className="mt-1 font-serif text-[15px] leading-snug text-ink">Would you like me to walk you through the OS?</p>
      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={() => { router.push("/team/" + userId + "/training"); setState("dismissed"); }}
          className="rounded-xl px-3 py-1.5 font-sans text-[12px] font-medium text-[#F7F7F4]"
          style={{ background: "var(--accent)" }}
        >
          Yes, walk me through
        </button>
        <button
          onClick={() => {
            const today = new Date().toISOString().slice(0, 10);
            try { localStorage.setItem("fs_newhire_nudge_dismissed_" + today, "1"); } catch {}
            setState("dismissed");
          }}
          className="font-sans text-[12px] text-ink-soft"
        >
          Later
        </button>
      </div>
    </div>
  );
}
