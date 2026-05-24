"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import AuthStatus from "@/components/AuthStatus";
import CommandK from "@/components/CommandK";

const ENTITY_LABEL: Record<string, string> = { holdings: "Holdings", bistro_mondo: "Bistro Mondo", taller: "Taller" };

export default function TopBar() {
  const [entity, setEntity] = useState("holdings");
  useEffect(() => {
    const read = () => { const e = localStorage.getItem("fs_entity"); if (e) setEntity(e); };
    read();
    window.addEventListener("storage", read);
    window.addEventListener("focus", read);
    return () => { window.removeEventListener("storage", read); window.removeEventListener("focus", read); };
  }, []);
  return (
    <header className="sticky top-0 z-40 border-b border-black/10 bg-paper/90 backdrop-blur">
      <div className="mx-auto flex max-w-xl items-center justify-between px-6 py-3">
        <Link href="/" className="font-serif text-[17px] text-ink">Food Studios</Link>
        <div className="flex items-center gap-3">
          <CommandK />
          <Link href="/" className="font-mono text-[11px] uppercase tracking-wide text-clay hover:text-ember">{ENTITY_LABEL[entity] || entity}</Link>
          <AuthStatus />
        </div>
      </div>
    </header>
  );
}
