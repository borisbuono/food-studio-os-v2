"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabaseBrowser";

// Verbose callback: every step logs to state so if sign-in fails the actual
// failure point is visible on screen instead of the ambient "still Guest".
export default function Callback() {
  const router = useRouter();
  const [msg, setMsg] = useState("Signing you in…");
  const [debug, setDebug] = useState<string[]>([]);

  useEffect(() => {
    const log = (line: string) => setDebug((d) => [...d, line]);
    (async () => {
      try {
        const url = new URL(window.location.href);
        const errParam = url.searchParams.get("error");
        const errDesc = url.searchParams.get("error_description");
        if (errParam) {
          setMsg("Sign-in refused: " + (errDesc || errParam));
          return;
        }
        const code = url.searchParams.get("code");
        log("host: " + window.location.host);
        log("has code: " + (code ? "yes" : "no"));
        if (code) {
          const { error } = await supabaseBrowser.auth.exchangeCodeForSession(window.location.href);
          if (error) {
            setMsg("Exchange failed: " + error.message);
            log("exchange error: " + error.message);
            return;
          }
          log("exchange ok");
        }
        const { data, error: sessionErr } = await supabaseBrowser.auth.getSession();
        if (sessionErr) {
          setMsg("Session read failed: " + sessionErr.message);
          return;
        }
        if (!data.session) {
          setMsg("Sign-in didn't stick — cookie was not stored. Check Safari ITP or Private Browsing.");
          log("no session after exchange");
          return;
        }
        log("session ok: " + data.session.user.email);
        let dest = "/";
        try {
          try { await supabaseBrowser.rpc("sync_my_profile_from_invite"); } catch {}
          const { data: prof } = await supabaseBrowser
            .from("profiles").select("first_run_done_at").eq("id", data.session.user.id).maybeSingle();
          if (prof && !prof.first_run_done_at) dest = "/welcome";
        } catch {}
        log("redirecting to " + dest);
        router.replace(dest);
      } catch (e: any) {
        setMsg("Sign-in error: " + (e?.message || "unknown"));
        setDebug((d) => [...d, "throw: " + (e?.stack || e?.message || String(e))]);
      }
    })();
  }, [router]);

  return (
    <main className="mx-auto max-w-xl lg:max-w-4xl px-6 py-12">
      <p className="font-serif text-2xl text-ink">{msg}</p>
      {debug.length > 0 ? (
        <pre className="mt-6 whitespace-pre-wrap rounded border border-black/10 bg-paper-deep/60 p-3 font-mono text-[11px] text-ink-soft">
          {debug.join("\n")}
        </pre>
      ) : null}
    </main>
  );
}
