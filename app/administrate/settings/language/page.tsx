import Link from "next/link";
import type { Metadata } from "next";
import LanguagePicker from "./LanguagePicker";
import { serverLang } from "@/lib/i18nServer";

export const metadata: Metadata = { title: "Language · Settings" };
export const dynamic = "force-dynamic";

// /administrate/settings/language — user can override the interface language
// at any time. The cookie fs_lang persists a year; on reload every server
// component re-reads it via serverLang().
//
// Boris walk 2026-09-20 runway d2: added for the Amsterdam launch. The
// header chip (LangChooser) cycles; this page shows the three options with
// their native labels so a Dutch cook without English can find their own
// language without guessing which code is theirs.
export default function LanguageSettings() {
  const current = serverLang();
  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/administrate/settings" className="font-sans text-sm text-ink-soft">← settings</Link>
      <p className="mt-6 font-sans text-xs font-medium text-ink-soft">Settings · language</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">Language</h1>
      <p className="mt-3 font-serif italic text-[15px] text-ink-soft">
        Pick your language. Menus, briefs and messages follow you. You can change this any time — it only affects your view.
      </p>
      <div className="mt-8">
        <LanguagePicker initial={current} />
      </div>
    </main>
  );
}
