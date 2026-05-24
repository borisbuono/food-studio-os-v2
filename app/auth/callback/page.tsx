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
        if (data.session) router.replace("/");
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
