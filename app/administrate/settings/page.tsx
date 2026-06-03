import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { noEmoji } from "@/lib/text";

export const dynamic = "force-dynamic";

export default async function Settings() {
  const acct = await supabase.from("accounting_integrations").select("*", { count: "exact", head: true });
  const booking = await supabase.from("booking_integrations").select("*", { count: "exact", head: true });
  const entityInt = await supabase.from("entity_integrations").select("*", { count: "exact", head: true });
  const skills = (await supabase.from("agent_skills").select("display_name,skill_code,model,provider,human_review_required,is_active").eq("is_active", true).order("display_name")).data || [];

  const conns = [
    { label: "Accounting (Holded)", n: acct.count ?? 0 },
    { label: "Bookings", n: booking.count ?? 0 },
    { label: "Entity integrations", n: entityInt.count ?? 0 },
  ];

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/" className="font-sans text-sm text-ink-soft">← home</Link>
      <p className="mt-6 font-sans text-xs font-medium text-ochre">Settings · connections & skills</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">The plumbing</h1>

      <section className="mt-8">
        <p className="font-sans text-xs font-medium text-clay">Connections</p>
        <ul className="mt-2 divide-y divide-black/10">
          {conns.map((c, i) => (
            <li key={i} className="flex items-baseline justify-between py-3">
              <span className="font-sans text-[15px] text-ink">{c.label}</span>
              <span className="font-mono text-[11px] text-clay">{c.n > 0 ? c.n + " connected" : "not connected"}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-10">
        <p className="font-sans text-xs font-medium text-clay">AI skills · {skills.length} <span className="text-clay/70">(admin)</span></p>
        <ul className="mt-2 divide-y divide-black/10">
          {skills.map((s: any, i: number) => (
            <li key={i} className="flex items-baseline justify-between gap-4 py-3">
              <div>
                <p className="font-sans text-[15px] text-ink">{noEmoji(s.display_name || s.skill_code)}</p>
                <p className="font-mono text-[10px] uppercase tracking-wide text-clay">{[s.provider, s.model].filter(Boolean).join(" · ")}</p>
              </div>
              {s.human_review_required ? <span className="font-mono text-[10px] uppercase tracking-wide text-ochre">human review</span> : null}
            </li>
          ))}
          {!skills.length ? <p className="py-3 font-sans text-[14px] text-clay">No skills configured.</p> : null}
        </ul>
      </section>
    </main>
  );
}
