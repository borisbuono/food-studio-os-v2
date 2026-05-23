import Link from "next/link";

const worlds = [
  { href: "/develop", kicker: "Develop", title: "The craft", blurb: "Menu, recipes, costing, story — where every dish is built." },
  { href: "/execute", kicker: "Execute", title: "Service", blurb: "Today’s priorities, prep, cook mode, cleaning — the daily loop." },
  { href: "/administrate", kicker: "Administrate", title: "The house", blurb: "Finance, decisions, team & schedule, the holding view." },
];

export default function Home() {
  return (
    <main className="mx-auto max-w-xl px-6 py-14">
      <p className="font-sans text-xs font-medium text-ember">Food Studios</p>
      <h1 className="mt-2 font-serif text-4xl leading-tight text-ink">The house is yours.</h1>
      <p className="mt-4 max-w-md font-sans text-[16px] leading-relaxed text-ink-soft">
        Three worlds — develop the craft, execute service, run the house.
      </p>
      <div className="mt-10 space-y-4">
        {worlds.map((w) => (
          <Link key={w.href} href={w.href} className="block rounded-2xl border border-black/10 bg-card p-6 transition hover:border-ember/40">
            <p className="font-sans text-xs font-medium text-ember">{w.kicker}</p>
            <h2 className="mt-1 font-serif text-2xl text-ink">{w.title}</h2>
            <p className="mt-2 font-sans text-[14px] leading-relaxed text-ink-soft">{w.blurb}</p>
          </Link>
        ))}
      </div>
      <p className="mt-12 font-mono text-[11px] text-clay">v2 foundation · reading live Supabase data</p>
    </main>
  );
}
