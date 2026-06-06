"use client";
import { useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabaseBrowser";

export default function Login() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const google = async () => {
    setErr("");
    const { error } = await supabaseBrowser.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin + "/auth/callback" } });
    if (error) setErr(error.message);
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr("");
    const { error } = await supabaseBrowser.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin + "/auth/callback" } });
    setBusy(false);
    if (error) setErr(error.message); else setSent(true);
  };

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/" className="font-sans text-sm text-ink-soft">← home</Link>
      <p className="mt-6 font-sans text-xs font-medium text-ember">Sign in</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">Food Studios</h1>

      <button onClick={google} className="mt-6 w-full rounded-xl border border-black/20 bg-card px-6 py-4 font-sans text-[15px] font-medium text-ink transition hover:border-ember/50">Continue with Google</button>

      {sent ? (
        <p className="mt-6 font-serif text-[17px] leading-relaxed text-ink-soft">Check your email — a sign-in link is on its way to {email}.</p>
      ) : (
        <>
          <div className="my-5 flex items-center gap-3 text-clay"><span className="h-px flex-1 bg-black/10" /><span className="font-mono text-[10px] uppercase tracking-wide">or email a link</span><span className="h-px flex-1 bg-black/10" /></div>
          <form onSubmit={submit}>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@restaurant.com"
              className="w-full rounded-xl border border-black/15 bg-card px-4 py-3 font-sans text-[15px] text-ink outline-none focus:border-ember" />
            <button disabled={busy} className="mt-3 w-full rounded-xl bg-ember px-6 py-4 font-sans text-[15px] font-medium text-[#F7F7F4] disabled:opacity-60">{busy ? "Sending…" : "Email me a sign-in link"}</button>
          </form>
        </>
      )}
      {err ? <p className="mt-3 font-mono text-[11px] text-ember">{err}</p> : null}
      <p className="mt-8 font-mono text-[10px] uppercase tracking-wide text-clay">Google one-click · or magic link, no password</p>
    </main>
  );
}
