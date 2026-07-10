import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabaseServer";
import { findTemplate } from "@/lib/advisory/templates";
import ChecklistClient from "./ChecklistClient";

export const dynamic = "force-dynamic";

// The activation checklist for a single advisory client.
// One row per step — status + owner + notes. When every step lands in
// 'done' (or 'skipped') the trigger in the SQL layer flips the client
// status to 'active'. Shipping is a state, not a moment.
export default async function ChecklistPage({ params }: { params: { client_id: string } }) {
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const uid = u.user?.id || null;
  if (!uid) return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <p className="font-mono text-[10px] uppercase tracking-wide text-clay">sign in to view</p>
    </main>
  );

  const { data: client } = await sb.from("advisory_clients").select("*").eq("id", params.client_id).maybeSingle();
  if (!client) notFound();

  // Fetch existing checklist items. If none exist, seed from the template
  // that was chosen at wizard time (or fall back to the blank slate).
  const { data: existing } = await sb.from("advisory_checklist_items")
    .select("*")
    .eq("advisory_client_id", client.id)
    .order("sort_order");

  let items = existing || [];
  if (items.length === 0) {
    const templateKey = (client as any).template_key || "blank";
    const tpl = findTemplate(templateKey);
    if (tpl) {
      const rows = tpl.checklist_steps.map((s, i) => ({
        advisory_client_id: client.id,
        step_key: s.key,
        label: s.label,
        hint: s.hint || null,
        sort_order: i,
      }));
      // RLS enforces primary-advisor. This is a no-op for seat-holders.
      const seed = await sb.from("advisory_checklist_items").insert(rows).select("*");
      items = seed.data || [];
    }
  }

  const done = items.filter((r: any) => r.status === "done" || r.status === "skipped").length;
  const total = items.length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  return (
    <main className="mx-auto max-w-3xl px-6 py-12" style={{ ["--accent" as any]: "#3F4C28" }}>
      <Link href={"/administrate/advisor/" + client.id} className="font-mono text-[10px] uppercase tracking-wide text-clay">← {client.name}</Link>
      <p className="mt-6 font-mono text-[10px] uppercase tracking-wide text-clay">Advisory · activation checklist</p>
      <h1 className="mt-2 font-serif text-[34px] leading-[1.05] text-ink">Bring {client.name} live.</h1>
      <p className="mt-3 font-serif italic text-[15px] text-ink-soft">
        Every step below is what a new client needs before the OS is doing real work for them. When the list clears,
        the client flips to active — and the morning brief starts landing in their voice.
      </p>

      {/* Progress strip */}
      <section className="mt-8 border-t border-line pt-6">
        <div className="flex items-baseline justify-between">
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Progress</p>
          <p className="font-mono text-[10px] text-ink-soft">{done} of {total} · {pct}%</p>
        </div>
        <div className="mt-2 h-1 bg-line-soft">
          <div className="h-1 bg-basil" style={{ width: pct + "%" }} />
        </div>
      </section>

      {/* The list */}
      {items.length === 0 ? (
        <div className="mt-10 border border-dashed border-line px-6 py-10 text-center">
          <p className="font-serif italic text-[15px] text-ink-soft">
            No checklist yet — this client wasn't seeded from a template.
          </p>
          <p className="mt-2 font-mono text-[10px] text-clay">
            Re-run the onboarding wizard on the "advisory" branch to pick a template.
          </p>
        </div>
      ) : (
        <ChecklistClient clientId={client.id} initialItems={items as any[]} />
      )}
    </main>
  );
}
