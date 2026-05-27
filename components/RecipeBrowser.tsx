"use client";
import { useMemo, useState } from "react";
import { noEmoji } from "@/lib/text";

type R = { id: string; name: string; section: string | null; cost_per_portion: number | null; menu_price: number | null; hero_image_url: string | null };
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// Auto editorial cover: deterministic colour per section/name (no external photo needed).
const PALETTE = [
  { bg: "#B8552E", fg: "#F7F1E6" }, { bg: "#9A3122", fg: "#F7F1E6" }, { bg: "#3E5A37", fg: "#F7F1E6" },
  { bg: "#B5701C", fg: "#F7F1E6" }, { bg: "#5A6B3B", fg: "#F7F1E6" }, { bg: "#7A6A57", fg: "#F7F1E6" },
  { bg: "#2B3A45", fg: "#F7F1E6" }, { bg: "#E4A94B", fg: "#3A352D" },
];
function cover(key: string) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export default function RecipeBrowser({ recipes }: { recipes: R[] }) {
  const [q, setQ] = useState("");
  const [section, setSection] = useState<string>("All");

  const sections = useMemo(() => {
    const set = new Map<string, number>();
    recipes.forEach((r) => { const s = (r.section || "Other").trim() || "Other"; set.set(s, (set.get(s) || 0) + 1); });
    return Array.from(set.keys()).sort();
  }, [recipes]);

  const query = q.trim().toLowerCase();
  const filtered = useMemo(() => recipes.filter((r) => {
    const s = (r.section || "Other").trim() || "Other";
    if (section !== "All" && s !== section) return false;
    if (query && !noEmoji(r.name).toLowerCase().includes(query)) return false;
    return true;
  }), [recipes, section, query]);

  const grouped = section === "All" && !query;
  const groups = useMemo(() => {
    if (!grouped) return null;
    const g: Record<string, R[]> = {};
    filtered.forEach((r) => { const s = (r.section || "Other").trim() || "Other"; (g[s] ||= []).push(r); });
    return Object.keys(g).sort().map((k) => ({ section: k, items: g[k] }));
  }, [filtered, grouped]);

  const renderRow = (r: R) => {
    const mg = r.menu_price && r.cost_per_portion ? Math.round((1 - r.cost_per_portion / r.menu_price) * 100) : null;
    const name = noEmoji(r.name);
    const c = cover((r.section || "").trim() || name);
    return (
      <a key={r.id} href={"/recipes/" + r.id} className="flex items-center gap-3 py-2.5 transition hover:opacity-70">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg" style={{ backgroundColor: r.hero_image_url ? undefined : c.bg }}>
          {r.hero_image_url
            ? <img src={r.hero_image_url} alt="" className="h-full w-full object-cover" />
            : <span className="font-serif text-[19px] leading-none" style={{ color: c.fg }}>{(name[0] || "·").toUpperCase()}</span>}
        </span>
        <span className="min-w-0 flex-1 font-serif text-[18px] leading-tight text-ink">{name}</span>
        <span className="shrink-0 font-mono text-[12.5px] text-ink-soft">
          {r.cost_per_portion ? "€" + Number(r.cost_per_portion).toFixed(2) : "–"}
          {mg !== null ? <span className="ml-2 text-olive">{mg}%</span> : null}
        </span>
      </a>
    );
  };

  return (
    <div className="mt-7">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search recipes"
        className="w-full rounded-xl border border-black/15 bg-paper px-4 py-3 font-sans text-[15px] text-ink outline-none focus:border-tomato/50" />

      <div className="mt-3 -mx-6 flex gap-2 overflow-x-auto px-6 pb-1">
        {["All", ...sections].map((s) => (
          <button key={s} onClick={() => setSection(s)}
            className={"shrink-0 rounded-full border px-4 h-9 font-sans text-[13px] transition " + (section === s ? "border-tomato bg-tomato/10 text-ink" : "border-black/15 text-ink-soft")}>
            {s === "All" ? "All" : cap(s)}
          </button>
        ))}
      </div>

      <p className="mt-4 font-mono text-[10.5px] uppercase tracking-[0.18em] text-clay">
        {filtered.length} {filtered.length === 1 ? "recipe" : "recipes"}{section !== "All" ? " · " + cap(section) : ""}
      </p>

      {filtered.length === 0 ? (
        <p className="mt-6 font-serif text-[18px] text-ink-soft">Nothing matches that search.</p>
      ) : grouped && groups ? (
        <div className="mt-2">
          {groups.map((g) => (
            <section key={g.section} className="mt-5">
              <p className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-tomato">{cap(g.section)}</p>
              <div className="mt-1 divide-y divide-black/10">{g.items.map(renderRow)}</div>
            </section>
          ))}
        </div>
      ) : (
        <div className="mt-2 divide-y divide-black/10">{filtered.map(renderRow)}</div>
      )}
    </div>
  );
}
