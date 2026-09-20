"use client";
// Small client sidecar — handles the Supabase magic-link + Google sign-in
// with a redirect back to /auth/callback?next=/onboard/step-2.

import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { inputCls, labelCls, primaryBtn } from "@/components/OnboardShell";

export default function OnboardStep1Auth() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const callback = () => {
    if (typeof window === "undefined") return "/auth/callback?next=/onboard/step-2";
    const u = new URL("/auth/callback", window.location.origin);
    u.searchParams.set("next", "/onboard/step-2");
    return u.toString();
  };

  async function google() {
    setErr(null);
    const { error } = await supabaseBrowser.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callback() },
    });
    if (error) setErr(error.message);
  }

  async function magic(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const { error } = await supabaseBrowser.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: callback() },
    });
    setBusy(false);
    if (error) setErr(error.message); else setSent(true);
  }

  if (sent) {
    return (
      <div>
        <p className="font-serif text-[17px] text-ink">
          Check your email — a sign-in link is on its way to <span className="font-mono">{email}</span>.
        </p>
        <p className="mt-2 font-sans text-[13px] text-ink-soft">
          Open it from the same browser and you'll continue at step 2.
        </p>
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={google}
        className="w-full rounded-xl border border-black/20 bg-card px-6 py-4 font-sans text-[15px] font-medium text-ink transition hover:border-ink/40"
      >
        Continue with Google
      </button>

      <div className="my-5 flex items-center gap-3 text-clay">
        <span className="h-px flex-1 bg-black/10" />
        <span className="font-mono text-[10px] uppercase tracking-wide">or email me a link</span>
        <span className="h-px flex-1 bg-black/10" />
      </div>

      <form onSubmit={magic}>
        <label className="block">
          <span className={labelCls}>Email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@restaurant.com"
            className={inputCls}
          />
        </label>
        <button disabled={busy} className={primaryBtn + " mt-4 w-full"}>
          {busy ? "Sending…" : "Email me a sign-in link"}
        </button>
      </form>

      {err ? <p className="mt-3 font-mono text-[11px] text-tomato">{err}</p> : null}
      <p className="mt-8 font-mono text-[10px] uppercase tracking-wide text-clay">
        No password. One click and you're in.
      </p>
    </div>
  );
}
