import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";
import { SupplierChip, PersonChip, RecipeChip, InvoiceChip } from "@/components/chips";

export const dynamic = "force-dynamic";

// URL note: this route stays at /administrate/chef-log for continuity —
// operators have bookmarked it. Internal reads now target the renamed
// assistant_* tables (Sprint 1 rename). The URL will move to
// /administrate/assistant-log in Sprint 6 with a 308 redirect from here.

const eur = (n: any) => n == null ? "—" : "€" + Number(n).toFixed(2);
const fmt = (d: any) => { try { const x = new Date(d); return x.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };

export default async function ChefLog() {
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user?.id) return (
    <main className="mx-auto max-w-3xl px-6 py-10"><p className="font-mono text-[10px] uppercase tracking-wide text-clay">sign in to view</p></main>
  );

  const [{ data: turns }, { data: memory }, { data: actions }] = await Promise.all([
    sb.from("assistant_conversations").select("id,turn_role,text,intent,confidence,session_id,route,created_at").order("created_at", { ascending: false }).limit(200),
    sb.from("assistant_memory").select("id,fact,scope,confirmed_at,retired_at,source_conversation_id").is("retired_at", null).order("confirmed_at", { ascending: false }).limit(50),
    sb.from("assistant_actions").select("id,action_type,target_table,target_id,payload,reversible,undone_at,created_at").order("created_at", { ascending: false }).limit(50),
  ]);

  // Group turns by session
  const sessions: Record<string, any[]> = {};
  (turns || []).forEach((t: any) => {
    const k = t.session_id || "no-session";
    if (!sessions[k]) sessions[k] = [];
    sessions[k].push(t);
  });
  const sessionKeys = Object.keys(sessions).sort((a, b) => {
    const ta = sessions[a][0]?.created_at, tb = sessions[b][0]?.created_at;
    return new Date(tb).getTime() - new Date(ta).getTime();
  });


  // Route target_table/target_id to a Chip so the audit becomes tappable — the
  // whole cross-pillar linking principle applied to Chef's own log.
  function targetChip(table: string | null, id: string | null) {
    if (!id) return <span className="font-mono text-[10px] text-muted">—</span>;
    if (table === "providers" || table === "provider") return <SupplierChip id={id} name={id.slice(0,8)} className="font-mono text-[10px]" />;
    if (table === "profiles" || table === "team_members") return <PersonChip id={id} name={id.slice(0,8)} className="font-mono text-[10px]" />;
    if (table === "menu_items" || table === "recipes") return <RecipeChip id={id} name={id.slice(0,8)} className="font-mono text-[10px]" />;
    if (table === "invoice_inbox" || table === "invoices") return <InvoiceChip id={id} name={id.slice(0,8)} className="font-mono text-[10px]" />;
    return <span className="font-mono text-[10px] text-muted">{id.slice(0,8)}</span>;
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Link href="/administrate" className="font-mono text-[10px] uppercase tracking-wide text-clay">← administrate</Link>
      <h1 className="mt-3 font-serif text-[34px] leading-[1.05] text-ink">Chef log</h1>
      <p className="mt-2 font-serif italic text-[14px] text-ink-soft">Everything Chef said, remembered, and did on your behalf.</p>

      <section className="mt-8">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Memory · {memory?.length || 0} active facts</p>
        {!memory?.length ? <p className="mt-2 font-serif italic text-[14px] text-muted">No remembered facts yet — say "Chef, remember that…" to start.</p> : (
          <ul className="mt-3 divide-y divide-line border-t border-line">
            {memory.map((m: any) => (
              <li key={m.id} className="flex items-start justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="font-serif text-[15px] text-ink">{m.fact}</p>
                  <p className="font-mono text-[10px] text-muted">{m.scope || "global"} · {fmt(m.confirmed_at)}</p>
                </div>
                <form action={`/api/chef/retire-memory`} method="post"><input type="hidden" name="id" value={m.id} /><button type="submit" className="font-mono text-[10px] uppercase tracking-wide text-clay hover:text-tomato">retire</button></form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Actions audit · {actions?.length || 0}</p>
        {!actions?.length ? <p className="mt-2 font-serif italic text-[14px] text-muted">No actions yet — Chef hasn't done anything on your behalf.</p> : (
          <ul className="mt-3 divide-y divide-line border-t border-line">
            {actions.map((a: any) => (
              <li key={a.id} className="py-3">
                <p className="font-serif text-[15px] text-ink">{a.action_type} {a.undone_at ? <span className="ml-2 font-mono text-[10px] text-tomato">UNDONE</span> : null}</p>
                <p className="font-mono text-[10px] text-muted">{a.target_table || "—"} · {targetChip(a.target_table, a.target_id)} · {fmt(a.created_at)} {a.reversible && !a.undone_at ? "· reversible" : ""}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Conversations · {sessionKeys.length} sessions</p>
        {!sessionKeys.length ? <p className="mt-2 font-serif italic text-[14px] text-muted">No conversations yet — tap Chef anywhere to start one.</p> : sessionKeys.slice(0, 12).map((k) => {
          const arr = sessions[k];
          const first = arr[arr.length - 1];
          return (
            <details key={k} className="mt-4 border-t border-line pt-3">
              <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-wide text-clay">{fmt(first.created_at)} · {first.route || "—"} · {arr.length} turn{arr.length === 1 ? "" : "s"}</summary>
              <div className="mt-3 space-y-2 pl-4">
                {arr.slice().reverse().map((t: any) => (
                  <div key={t.id}>
                    <p className={`font-mono text-[10px] uppercase tracking-wide ${t.turn_role === "user" ? "text-ink" : "text-clay"}`}>{t.turn_role}{t.intent ? ` · ${t.intent}` : ""}{t.confidence != null ? ` · ${Math.round(t.confidence * 100)}%` : ""}</p>
                    <p className={`font-serif text-[14px] ${t.turn_role === "user" ? "text-ink" : "text-ink-soft"}`}>{t.text}</p>
                  </div>
                ))}
              </div>
            </details>
          );
        })}
      </section>
    </main>
  );
}
