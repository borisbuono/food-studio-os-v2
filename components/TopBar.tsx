"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import AuthStatus from "@/components/AuthStatus";
import CommandK from "@/components/CommandK";
import { EntityKey, ENTITY_ACCENT } from "@/lib/entities";
import BrandMark from "@/components/BrandMark";

export default function TopBar() {
  const [entity, setEntity] = useState<EntityKey>("holdings");
  useEffect(() => {
    const read = () => {
      const e = localStorage.getItem("fs_entity") as EntityKey | null;
      if (e) setEntity(e);
      const ua = localStorage.getItem("fs_user_accent");
      document.documentElement.style.setProperty("--accent", ua || (e ? ENTITY_ACCENT[e] : "") || "#B8552E");
    };
    read();
    window.addEventListener("storage", read);
    window.addEventListener("focus", read);
    return () => { window.removeEventListener("storage", read); window.removeEventListener("focus", read); };
  }, []);
  return (
    <header className="sticky top-0 z-40 border-b border-black/10 bg-paper/90 backdrop-blur">
      <div className="mx-auto flex max-w-xl items-center justify-between px-6 py-3">
        <Link href="/" className="flex items-center"><BrandMark entity={entity} variant="mark" tone="light" /></Link>
        <div className="flex items-center gap-3">
          <CommandK />
          <AuthStatus />
        </div>
      </div>
    </header>
  );
}
