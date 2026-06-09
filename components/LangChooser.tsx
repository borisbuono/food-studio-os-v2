"use client";
import { useEffect, useState } from "react";
import { getLang, setLang, Lang } from "@/lib/i18n";

export default function LangChooser() {
  const [lang, setL] = useState<Lang>("en");
  useEffect(() => { setL(getLang()); }, []);
  const next: Lang = lang === "en" ? "es" : "en";
  return (
    <button onClick={() => setLang(next)} className="font-mono text-[10px] uppercase tracking-wider text-clay hover:text-ink" aria-label="switch language">
      {lang === "en" ? "EN · es" : "ES · en"}
    </button>
  );
}
