"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabaseBrowser";

export default function AuthStatus() {
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => {
    supabaseBrowser.auth.getSession().then(({ data }) => setEmail(data.session?.user?.email ?? null));
    const { data: sub } = supabaseBrowser.auth.onAuthStateChange((_e, s) => setEmail(s?.user?.email ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);
  if (email) {
    return (
      <span className="font-mono text-[11px] text-clay">
        {email} · <button onClick={() => supabaseBrowser.auth.signOut()} className="text-ember">sign out</button>
      </span>
    );
  }
  return <Link href="/login" className="font-mono text-[11px] text-ember">Sign in</Link>;
}
