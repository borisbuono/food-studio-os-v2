import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <p className="font-sans text-xs font-medium text-ember">Food Studios · v2 foundation</p>
      <h1 className="mt-3 font-serif text-4xl leading-tight text-ink">The house, on a clean foundation.</h1>
      <p className="mt-4 max-w-md font-sans text-[17px] leading-relaxed text-ink-soft">
        Next.js + TypeScript + Tailwind, reading the real Supabase database. This is the staging
        rebuild — the live app stays untouched until this is at parity.
      </p>
      <Link href="/menu" className="mt-8 inline-block rounded-xl bg-ember px-6 py-4 font-sans text-[15px] font-medium text-[#FCEFE7]">
        Open the menu →
      </Link>
    </main>
  );
}
