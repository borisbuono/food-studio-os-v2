"use client";
// Nuclear reset: wipes localStorage session keys + all sb-* cookies. Use when
// stuck in a bad state (legacy localStorage session that servers can't see).
function hardResetSession() {
  try {
    Object.keys(localStorage).forEach((k) => {
      if (k.includes("supabase") || k.includes("sb-") || k.startsWith("fs-auth")) localStorage.removeItem(k);
    });
  } catch {}
  try {
    // Cookies may have been written host-only OR with domain=.foodstudio.ai
    // (see lib/authCookies.ts). Nuke every variant so nothing survives.
    const host = window.location.hostname;
    const domains: (string | undefined)[] = [undefined, host];
    if (host === "foodstudio.ai" || host.endsWith(".foodstudio.ai")) {
      domains.push(".foodstudio.ai");
    }
    document.cookie.split(";").forEach((c) => {
      const [n] = c.trim().split("=");
      if (n.startsWith("sb-") || n.includes("supabase")) {
        domains.forEach((d) => {
          const domClause = d ? `; domain=${d}` : "";
          document.cookie = `${n}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${domClause}`;
        });
      }
    });
  } catch {}
  window.location.href = "/login";
}
import FabHidden from "@/components/FabHidden";
import { useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabaseBrowser";

import { useEffect as _useEffect } from "react";
function useEffectOnce(fn: () => void) { _useEffect(() => { fn(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []); }

export default function Login() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [next, setNext] = useState("/");

  // Surface the ?error= that the /auth/callback Route Handler
  // redirects here with on any failure. Also grab ?next= from the middleware
  // redirect so we can bounce back to where the user was after sign-in.
  useEffectOnce(() => {
    try {
      const u = new URL(window.location.href);
      const e = u.searchParams.get("error");
      if (e) setErr(e);
      const n = u.searchParams.get("next");
      if (n && n.startsWith("/") && !n.startsWith("//")) setNext(n);
    } catch {}
  });

  // Build the callback URL with a preserved `next` so /auth/callback can
  // redirect the browser back to the originally-requested path after the
  // session cookie is written.
  const callbackUrl = () => {
    const u = new URL("/auth/callback", window.location.origin);
    if (next && next !== "/") u.searchParams.set("next", next);
    return u.toString();
  };

  const google = async () => {
    setErr("");
    const { error } = await supabaseBrowser.auth.signInWithOAuth({ provider: "google", options: { redirectTo: callbackUrl() } });
    if (error) setErr(error.message);
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr("");
    const { error } = await supabaseBrowser.auth.signInWithOtp({ email, options: { emailRedirectTo: callbackUrl() } });
    setBusy(false);
    if (error) setErr(error.message); else setSent(true);
  };

  return (
    <main className="mx-auto max-w-xl lg:max-w-4xl px-6 py-12">
      <div className="flex justify-end px-6 py-2"><button onClick={hardResetSession} className="font-mono text-[10px] uppercase tracking-wide text-clay hover:text-tomato">↻ hard reset session</button></div><FabHidden />
      <Link href="/" className="font-sans text-sm text-ink-soft">← home</Link>
      <p className="mt-6 font-sans text-xs font-medium text-ink-soft">Sign in</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">Food Studios</h1>

      <button onClick={google} className="mt-6 w-full rounded-xl border border-black/20 bg-card px-6 py-4 font-sans text-[15px] font-medium text-ink transition hover:border-ink/40">Continue with Google</button>

      {sent ? (
        <p className="mt-6 font-serif text-[17px] leading-relaxed text-ink-soft">Check your email — a sign-in link is on its way to {email}.</p>
      ) : (
        <>
          <div className="my-5 flex items-center gap-3 text-clay"><span className="h-px flex-1 bg-black/10" /><span className="font-mono text-[10px] uppercase tracking-wide">or email a link</span><span className="h-px flex-1 bg-black/10" /></div>
          <form onSubmit={submit}>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@restaurant.com"
              className="w-full rounded-xl border border-black/15 bg-card px-4 py-3 font-sans text-[15px] text-ink outline-none focus:border-ink" />
            <button disabled={busy} className="mt-3 w-full rounded-xl bg-[color:var(--accent)] px-6 py-4 font-sans text-[15px] font-medium text-[#F7F7F4] disabled:opacity-60">{busy ? "Sending…" : "Email me a sign-in link"}</button>
          </form>
        </>
      )}
      {err ? <p className="mt-3 font-mono text-[11px] text-ink-soft">{err}</p> : null}
      <p className="mt-8 font-mono text-[10px] uppercase tracking-wide text-clay">Google one-click · or magic link, no password</p>
    </main>
  );
}
