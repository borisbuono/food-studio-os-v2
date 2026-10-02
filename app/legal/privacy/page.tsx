// /legal/privacy — the privacy notice (security S6, 2026-10-02). Public.
//
//   /legal/privacy                → platform notice (Food Studio OS as controller)
//   /legal/privacy?house=bm       → the house as controller, platform as processor
//   &lang=es|en                   → language (default: Spanish for ES houses, else EN)
//
// Linked from /apply/<house>, /book/<slug>, /m/<slug>/book, /m/<slug>/private
// and the onboarding wizard. Text lives in lib/legal/privacyNotice.ts; the
// controller block is read server-side with the service role
// (privacy_page_controller) so the tax id never crosses a public API (P0-8).

import type { Metadata } from "next";
import { supabaseService } from "@/lib/supabaseService";
import { privacyNotice, PLATFORM, NOTICE_UPDATED, type Controller, type Lang } from "@/lib/legal/privacyNotice";
import { APPLY_CONTACT } from "@/lib/hiring-apply";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Privacidad · Privacy — Food Studio OS", robots: { index: true } };

async function loadController(slug: string | null): Promise<{ c: Controller; house: string | null; es: boolean }> {
  const svc = supabaseService();
  const read = async (s: string) => {
    if (!svc) return null;
    const { data } = await svc.rpc("privacy_page_controller", { p_slug: s });
    return (data as any) || null;
  };
  const platformRow = await read("holdings");
  const platform: Controller = platformRow
    ? { name: PLATFORM.name, legalName: `${platformRow.legal_name} (Ibiza Food Studio)`, taxId: platformRow.tax_id ?? null, address: platformRow.address ?? PLATFORM.address, contact: PLATFORM.contact }
    : PLATFORM;
  if (!slug || slug === "holdings") return { c: platform, house: null, es: true };
  const row = await read(slug);
  if (!row) return { c: platform, house: null, es: true };
  const contact = APPLY_CONTACT[slug] || PLATFORM.contact;
  return {
    c: { name: row.name, legalName: row.legal_name, taxId: row.tax_id ?? null, address: row.address ?? null, contact },
    house: row.name,
    es: String(row.address || "").endsWith("ES") || slug === "bm" || slug === "taller",
  };
}

export default async function PrivacyPage({ searchParams }: { searchParams: { house?: string; lang?: string } }) {
  const slug = (searchParams.house || "").trim().toLowerCase() || null;
  const { c, house, es } = await loadController(slug);
  const lang: Lang = searchParams.lang === "en" || searchParams.lang === "es" ? searchParams.lang : es ? "es" : "en";
  const sections = privacyNotice(lang, c, house);
  const other: Lang = lang === "es" ? "en" : "es";
  const q = (l: Lang) => `/legal/privacy?${slug ? `house=${encodeURIComponent(slug)}&` : ""}lang=${l}`;
  const title = lang === "es" ? "Protección de datos" : "Privacy notice";
  const sub = house
    ? (lang === "es" ? `Cómo ${house} trata tus datos` : `How ${house} handles your data`)
    : (lang === "es" ? "Cómo Food Studio OS trata tus datos" : "How Food Studio OS handles your data");

  return (
    <main className="mx-auto max-w-2xl px-5 py-12 text-ink">
      <div className="flex items-baseline justify-between gap-4">
        <p className="font-mono text-[11px] uppercase tracking-[.2em] text-clay">{house || "Food Studio OS"}</p>
        <a href={q(other)} className="font-mono text-[11px] uppercase tracking-wide underline">{other === "es" ? "Español" : "English"}</a>
      </div>
      <h1 className="mt-3 font-serif text-3xl font-light">{title}</h1>
      <p className="mt-2 text-base opacity-70">{sub}</p>

      {sections.map((s) => (
        <section key={s.h} className="mt-8">
          <h2 className="font-mono text-[11px] uppercase tracking-wide text-clay">{s.h}</h2>
          {s.p.map((p, i) => (
            <p key={i} className="mt-2 text-[15px] leading-relaxed">{p}</p>
          ))}
        </section>
      ))}

      <p className="mt-12 font-mono text-[10px] text-clay">
        {lang === "es" ? "Versión" : "Version"} {NOTICE_UPDATED} · <a className="underline" href="/legal/privacy">Food Studio OS</a>
      </p>
    </main>
  );
}
