"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import AuthStatus from "@/components/AuthStatus";
import CommandK from "@/components/CommandK";
import { ENTITY_LABEL, ENTITY_WORDMARK, EntityKey } from "@/lib/entities";

export default function TopBar() {
  const [entity, setEntity] = useState<EntityKey>("holdings");
  useEffect(() => {
    const read = () => { const e = localStorage.getItem("fs_entity") as EntityKey | null; if (e) setEntity(e); };
    read();
    window.addEventListener("storage", read);
    window.addEventListener("focus", read);
    return () => { window.removeEventListener("storage", read); window.removeEventListener("focus", read); };
  }, []);
  return (
    <header className="sticky top-0 z-40 border-b border-black/10 bg-paper/90 backdrop-blur">
      <div className="mx-auto flex max-w-xl items-center justify-between px-6 py-3">
        <Link href="/" className={ENTITY_WORDMARK[entity]}>{ENTITY_LABEL[entity]}</Link>
        <div className="flex items-center gap-3">
          <CommandK />
          <AuthStatus />
        </div>
      </div>
    </header>
  );
}
