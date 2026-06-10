"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabaseBrowser";

export default function Callback() {
  const router = useRouter();
  const [msg, setMsg] = useState("Signing you in…");
  useEffect(() => {
    (async () => {
      try {
        const url = new URL(window.location.href);
        if (url.searchParams.get("code")) {
          await supabaseBrowser.auth.exchangeCodeForSession(window.location.href);
        }
        const { data } = await supabaseBrowser.auth.getSession();
        if (data.session) {
          // First sign-in → the 60-second first-run tour (column lands with the 20260611 migration)
          let dest = "/";
          try {
            try { await supabaseBrowser.rpc("sync_my_profile_from_invite"); } catch {}
            const { data: prof, error } = await supabaseBrowser
              .from("profiles").select("first_run_done_at").eq("id", data.session.user.id).maybeSingle();
            if (!error && prof && !prof.first_run_done_at) dest = "/welcome";
          } catch {}
          router.replace(dest);
        }
        else setMsg("Couldn’t complete sign-in — the link may have expired. Try again from the sign-in page.");
      } catch (e: any) {
        setMsg("Sign-in error: " + (e?.message || "unknown"));
      }
    })();
  }, [router]);
  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <p className="font-serif text-2xl text-ink">{msg}</p>
    </main>
  );
}
