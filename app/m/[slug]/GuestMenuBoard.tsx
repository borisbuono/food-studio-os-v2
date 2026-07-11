"use client";
import { useMemo, useState } from "react";
import { ALLERGEN_KEYS, DIETARY_KEYS, allergenLabel, dietaryLabel, copy, type GuestLang } from "@/lib/guest/allergens";
import type { GuestBrand } from "@/lib/guest/brand";

type Item = {
  id: string; name: string; name_es: string | null; name_de: string | null;
  section: string | null; price: number | null; description: string | null;
  description_es: string | null; description_de: string | null;
  is_special: boolean | null;
  category: string | null; course: string | null; wine_style: string | null;
  allergens: string[]; dietary: string[];
};
type Commercial = { id: string; type: string; title: string; description: string | null };
type Props = {
  lang: GuestLang; langsAvailable: GuestLang[]; brand: GuestBrand;
  commercials: Commercial[];
  specials: Item[]; food: Item[]; wine: Item[]; bar: Item[];
  empty: boolean;
};

function pickName(it: Item, lang: GuestLang): string {
  if (lang === "es" && it.name_es) return it.name_es;
  if (lang === "de" && it.name_de) return it.name_de;
  return it.name;
}
function pickDesc(it: Item, lang: GuestLang): string | null {
  if (lang === "es" && it.description_es) return it.description_es;
  if (lang === "de" && it.description_de) return it.description_de;
  return it.description;
}

function setGuestLang(l: GuestLang) {
  if (typeof document === "undefined") return;
  document.cookie = "fs_guest_lang=" + l + "; path=/; max-age=" + 60 * 60 * 24 * 365;
  window.location.reload();
}

export default function GuestMenuBoard(p: Props) {
  const [allergyExcl, setAllergyExcl] = useState<string[]>([]);
  const [diet, setDiet] = useState<string>("");
  const [showFilters, setShowFilters] = useState(false);

  const matches = (it: Item): boolean => {
    if (allergyExcl.some((a) => (it.allergens || []).includes(a))) return false;
    if (diet && !(it.dietary || []).includes(diet)) return false;
    return true;
  };
  const fs = useMemo(() => ({
    specials: p.specials.filter(matches),
    food: p.food.filter(matches),
    wine: p.wine.filter(matches),
    bar: p.bar.filter(matches),
  }), [allergyExcl, diet, p.specials, p.food, p.wine, p.bar]);
  const filteredAll = fs.specials.length + fs.food.length + fs.wine.length + fs.bar.length;
  const anyRaw = p.specials.length + p.food.length + p.wine.length + p.bar.length;

  const activeFilters = allergyExcl.length + (diet ? 1 : 0);

  return (
    <div className="mx-auto max-w-lg px-8">
      {/* Language + filters row */}
      <div className="mt-4 flex items-center justify-between border-y py-3" style={{ borderColor: p.brand.accent + "33" }}>
        <div className="flex gap-3">
          {p.langsAvailable.map((L) => (
            <button
              key={L}
              onClick={() => setGuestLang(L)}
              className={"font-mono text-[10.5px] uppercase tracking-[0.2em] " + (L === p.lang ? "" : "opacity-50")}
              style={{ color: L === p.lang ? p.brand.accent : p.brand.clay }}
            >
              {L}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowFilters((v) => !v)}
          className="font-mono text-[10.5px] uppercase tracking-[0.2em]"
          style={{ color: p.brand.accent }}
        >
          {showFilters ? copy("m.filter.clear", p.lang) : `Filters${activeFilters ? ` · ${activeFilters}` : ""}`}
        </button>
      </div>

      {showFilters && (
        <div className="mt-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.24em]" style={{ color: p.brand.clay }}>
            {copy("m.filter.allergens", p.lang)}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {ALLERGEN_KEYS.map((k) => {
              const on = allergyExcl.includes(k);
              return (
                <button
                  key={k}
                  onClick={() => setAllergyExcl((s) => on ? s.filter((x) => x !== k) : [...s, k])}
                  className="rounded-full border px-3 py-1 font-sans text-[12px] transition"
                  style={{
                    borderColor: on ? p.brand.accent : p.brand.accent + "44",
                    background: on ? p.brand.accent : "transparent",
                    color: on ? "#FBF7EF" : p.brand.inkSoft,
                  }}
                >
                  {allergenLabel(k, p.lang)}
                </button>
              );
            })}
          </div>

          <p className="mt-6 font-mono text-[10px] uppercase tracking-[0.24em]" style={{ color: p.brand.clay }}>
            {copy("m.filter.diet", p.lang)}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {DIETARY_KEYS.map((k) => {
              const on = diet === k;
              return (
                <button
                  key={k}
                  onClick={() => setDiet(on ? "" : k)}
                  className="rounded-full border px-3 py-1 font-sans text-[12px] transition"
                  style={{
                    borderColor: on ? p.brand.accent : p.brand.accent + "44",
                    background: on ? p.brand.accent : "transparent",
                    color: on ? "#FBF7EF" : p.brand.inkSoft,
                  }}
                >
                  {dietaryLabel(k, p.lang)}
                </button>
              );
            })}
          </div>

          {(allergyExcl.length || diet) ? (
            <button
              onClick={() => { setAllergyExcl([]); setDiet(""); }}
              className="mt-6 font-mono text-[10.5px] uppercase tracking-[0.2em] underline underline-offset-4"
              style={{ color: p.brand.clay }}
            >
              {copy("m.filter.clear", p.lang)}
            </button>
          ) : null}
        </div>
      )}

      {/* Active commercials — happy hour banners etc. */}
      {p.commercials.length ? (
        <section className="mt-10">
          {p.commercials.map((c) => (
            <div key={c.id} className="mb-3 rounded border px-4 py-3" style={{ borderColor: p.brand.accent + "55", background: p.brand.accent + "0D" }}>
              <p className="font-mono text-[9.5px] uppercase tracking-[0.28em]" style={{ color: p.brand.accent }}>{c.type.replace(/_/g, " ")}</p>
              <p className={`mt-1 text-[19px] ${p.brand.displayClass}`} style={{ color: p.brand.ink }}>{c.title}</p>
              {c.description ? <p className="mt-1 font-serif text-[14px] italic" style={{ color: p.brand.inkSoft }}>{c.description}</p> : null}
            </div>
          ))}
        </section>
      ) : null}

      {/* Empty states */}
      {p.empty ? (
        <p className="mt-16 text-center font-serif italic text-[17px]" style={{ color: p.brand.inkSoft }}>
          {copy("m.empty", p.lang)}
        </p>
      ) : (filteredAll === 0 && anyRaw > 0) ? (
        <p className="mt-16 text-center font-serif italic text-[17px]" style={{ color: p.brand.inkSoft }}>
          {copy("m.filtered.empty", p.lang)}
        </p>
      ) : null}

      {/* Specials */}
      {fs.specials.length ? (
        <Section title={copy("m.today", p.lang)} blurb={copy("m.section.specials.blurb", p.lang)} brand={p.brand}>
          {fs.specials.map((it) => <ItemLine key={it.id} it={it} lang={p.lang} brand={p.brand} />)}
        </Section>
      ) : null}

      {/* Full menu — food */}
      {fs.food.length ? (
        <Section title={copy("m.menu", p.lang)} brand={p.brand}>
          {fs.food.map((it) => <ItemLine key={it.id} it={it} lang={p.lang} brand={p.brand} />)}
        </Section>
      ) : null}

      {/* Wine */}
      {fs.wine.length ? (
        <Section title={copy("m.wine", p.lang)} brand={p.brand}>
          {fs.wine.map((it) => <ItemLine key={it.id} it={it} lang={p.lang} brand={p.brand} />)}
        </Section>
      ) : null}

      {/* Bar */}
      {fs.bar.length ? (
        <Section title={copy("m.bar", p.lang)} brand={p.brand}>
          {fs.bar.map((it) => <ItemLine key={it.id} it={it} lang={p.lang} brand={p.brand} />)}
        </Section>
      ) : null}
    </div>
  );
}

function Section({ title, blurb, brand, children }: { title: string; blurb?: string; brand: GuestBrand; children: React.ReactNode }) {
  return (
    <section className="mt-14">
      <p className="font-mono text-[10px] uppercase tracking-[0.28em]" style={{ color: brand.accent }}>{title}</p>
      {blurb ? <p className="mt-1 font-serif italic text-[14.5px]" style={{ color: brand.clay }}>{blurb}</p> : null}
      <ul className="mt-4">{children}</ul>
    </section>
  );
}

function ItemLine({ it, lang, brand }: { it: Item; lang: GuestLang; brand: GuestBrand }) {
  const name = pickName(it, lang);
  const desc = pickDesc(it, lang);
  return (
    <li className="border-b py-4" style={{ borderColor: brand.accent + "1F" }}>
      <div className="flex items-baseline justify-between gap-4">
        <span className={`flex-1 text-[19px] leading-tight ${brand.displayClass}`} style={{ color: brand.ink }}>
          {name}
        </span>
        {it.price !== null ? (
          <span className="font-mono text-[13px]" style={{ color: brand.inkSoft }}>€{it.price}</span>
        ) : null}
      </div>
      {desc ? <p className="mt-1.5 font-serif italic text-[14.5px] leading-relaxed" style={{ color: brand.inkSoft }}>{desc}</p> : null}

      {(it.allergens.length || it.dietary.length) ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {it.dietary.map((d) => (
            <span key={"d-" + d} className="rounded-full border px-2 py-0.5 font-sans text-[10.5px]" style={{ borderColor: brand.accent + "55", color: brand.accent }}>
              {dietaryLabel(d, lang)}
            </span>
          ))}
          {it.allergens.map((a) => (
            <span key={"a-" + a} className="rounded-full px-2 py-0.5 font-sans text-[10.5px]" style={{ background: brand.accent + "12", color: brand.inkSoft }}>
              {copy("m.contains", lang)}: {allergenLabel(a, lang)}
            </span>
          ))}
        </div>
      ) : null}
    </li>
  );
}
