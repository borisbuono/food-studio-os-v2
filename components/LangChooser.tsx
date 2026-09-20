"use client";
import { useEffect, useState } from "react";
import { getLang, setLang, Lang, LANGS, LANG_LABEL } from "@/lib/i18n";

// Three-language chooser (EN → NL → ES → EN). Boris's rule for the header:
// stay slim. The chip shows the current locale + the NEXT one it will cycle
// to, so a tap moves forward without a menu.
export default function LangChooser() {
  const [lang, setL] = useState<Lang>("en");
  useEffect(() => { setL(getLang()); }, []);
  const idx = LANGS.indexOf(lang);
  const next: Lang = LANGS[(idx + 1) % LANGS.length];
  return (
    <button
      onClick={() => setLang(next)}
      className="font-mono text-[10px] uppercase tracking-wider text-clay hover:text-ink"
      aria-label={`switch language to ${LANG_LABEL[next]}`}
      title={`Switch to ${LANG_LABEL[next]}`}
    >
      {lang.toUpperCase()} · {next}
    </button>
  );
}
