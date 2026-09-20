"use client";
import { useState } from "react";
import { setLang, Lang, LANGS, LANG_LABEL } from "@/lib/i18n";

export default function LanguagePicker({ initial }: { initial: Lang }) {
  const [current, setCurrent] = useState<Lang>(initial);
  const pick = (l: Lang) => {
    setCurrent(l);
    // setLang() writes the cookie and reloads so server components pick it up.
    setLang(l);
  };
  return (
    <div className="grid gap-2">
      {LANGS.map((l) => {
        const active = l === current;
        return (
          <button
            key={l}
            onClick={() => pick(l)}
            className={
              "flex items-baseline justify-between rounded-xl border px-5 py-4 text-left transition " +
              (active
                ? "border-ink bg-ink text-paper"
                : "border-black/15 bg-transparent text-ink hover:border-ink/40")
            }
            aria-pressed={active}
          >
            <span className="font-serif text-[19px]">{LANG_LABEL[l]}</span>
            <span className="font-mono text-[10px] uppercase tracking-wider opacity-70">
              {l}{active ? " · current" : ""}
            </span>
          </button>
        );
      })}
      <p className="mt-3 font-mono text-[10px] uppercase tracking-wider text-clay">
        Persisted in a cookie · one year · this device
      </p>
    </div>
  );
}
