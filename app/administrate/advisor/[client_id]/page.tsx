import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabaseServer";
import ClientDashboardActions from "./ClientDashboardActions";
import ClientInviteForm from "./ClientInviteForm";
import AssistantContext from "@/components/AssistantContext";

export const dynamic = "force-dynamic";

// Per-client dashboard — the deep view of a single advisory client.
// Overview: venues, seats, connection status. Assistant health card.
// Impersonate button. Invite team seat. Pause/reactivate.
export default async function AdvisoryClientDashboard({ params }: { params: { client_id: string } }) {
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const uid = u.user?.id || null;
  if (!uid) return (
    <main className="mx-auto max-w-4xl lg:max-w-6xl px-6 py-12">
      <p className="font-mono text-[10px] uppercase tracking-wide text-clay">sign in to view</p>
    </main>
  );

  const { data: client } = await sb.from("advisory_clients").select("*").eq("id", params.client_id).maybeSingle();
  if (!client) notFound();

  const [venuesRes, seatsRes, cfgRes, tierRes, mtdRes, briefRes, integrationsRes] = await Promise.all([
    sb.from("advisory_venues").select("*").eq("advisory_client_id", client.id).order("name"),
    sb.from("advisory_seats").select("*").eq("advisory_client_id", client.id).order("invited_at", { ascending: false }),
    sb.from("assistant_config").select("*").eq("entity_code", client.entity_code).maybeSingle(),
    sb.from("assistant_billing_tiers").select("*"),
    sb.from("v_assistant_entity_mtd").select("actions,cost_eur,avg_latency_ms").eq("entity_code", client.entity_code).maybeSingle(),
    sb.from("assistant_briefs").select("date,body").eq("entity_code", client.entity_code).order("date", { ascending: false }).limit(1),
    // integrations — a proxy count for now. If the entity has any integrations_vault
    // rows we assume that connector is set up. Advisory client venues carry the
    // restaurant_id, so we look up by that.
    sb.from("integrations_vault").select("provider,restaurant_id").limit(50),
  ]);

  const venues = venuesRes.data || [];
  const seats  = seatsRes.data  || [];
  const cfg    = cfgRes.data;
  const tiers  = tierRes.data   || [];
  const mtd    = mtdRes.data as any;
  const brief  = (briefRes.data || [])[0] as any;
  const integrationsAll = integrationsRes.data || [];

  const venueRestaurantIds = new Set(venues.map((v: any) => v.restaurant_id).filter(Boolean));
  const providersForClient = new Set(
    integrationsAll
      .filter((i: any) => !i.restaurant_id || venueRestaurantIds.has(i.restaurant_id))
      .map((i: any) => String(i.provider || "").toLowerCase())
  );

  const tierRow = tiers.find((t: any) => t.name === (cfg?.billing_tier || client.tier)) as any;
  const actionsUsed = Number(mtd?.actions   || 0);
  const costUsed    = Number(mtd?.cost_eur  || 0);
  const actionsCap  = Number(tierRow?.monthly_action_cap || 0);
  const costCap     = Number(tierRow?.monthly_cost_cap_eur || 0);

  const acceptedSeats = seats.filter((s: any) => s.accepted_at && !s.revoked_at);
  const pendingSeats  = seats.filter((s: any) => !s.accepted_at && !s.revoked_at);

  // Connection matrix — which integrations are set up
  const conns = [
    { key: "holded",   label: "Holded",  connected: providersForClient.has("holded") },
    { key: "fresto",   label: "Fresto",  connected: providersForClient.has("fresto") },
    { key: "bank",     label: "Bank",    connected: providersForClient.has("chift") || providersForClient.has("gocardless") || providersForClient.has("plaid") },
    { key: "gmail",    label: "Gmail",   connected: providersForClient.has("gmail") },
    { key: "whatsapp", label: "WhatsApp",connected: providersForClient.has("whatsapp_business") || providersForClient.has("whatsapp") },
  ];

  const statusChip: Record<string, string> = {
    prospect:   "bg-line-soft text-clay border-line",
    onboarding: "bg-amber/15 text-ochre border-ochre/40",
    active:     "bg-basil/15 text-basil border-basil/30",
    paused:     "bg-line-soft text-ink-soft border-line",
    churned:    "bg-line-soft text-clay border-line",
  };

  return (
    <main className="mx-auto max-w-4xl lg:max-w-6xl px-6 py-12" style={{ ["--accent" as any]: "#3F4C28" }}>
      <AssistantContext
        context={{
          kind: "advisor_client_dashboard",
          entity_code: client.entity_code,
          name: client.name,
          status: client.status,
          tier: client.tier,
          venues: venues.length,
          accepted_seats: acceptedSeats.length,
          pending_seats: pendingSeats.length,
          mtd_actions: actionsUsed,
          mtd_cost_eur: costUsed,
          brief_today: brief?.date === new Date().toISOString().slice(0,10),
        }}
      />

      <Link href="/administrate/advisor" className="font-mono text-[10px] uppercase tracking-wide text-clay">← advisor console</Link>
      <div className="mt-6 flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Advisory client · {client.entity_code}</p>
          <h1 className="mt-2 font-serif text-[34px] leading-[1.05] text-ink">{client.name}</h1>
          {client.fiscal_name ? (
            <p className="mt-1 font-mono text-[11px] text-clay">{client.fiscal_name}{client.cif ? " · CIF " + client.cif : ""}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          <span className={"inline-block border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide " + (statusChip[client.status] || "")}>
            {client.status}
          </span>
          <span className="font-mono text-[10px] text-clay capitalize">{client.tier}</span>
        </div>
      </div>

      <ClientDashboardActions
        clientId={client.id}
        entityCode={client.entity_code}
        status={client.status}
        checklistHref={"/administrate/advisor/" + client.id + "/checklist"}
      />

      {/* ─── Overview cards ─── */}
      <section className="mt-10 grid grid-cols-1 gap-6 border-t border-line pt-6 sm:grid-cols-3">
        <Card label="Venues" value={String(venues.length)}>
          {venues.length === 0 ? (
            <p className="mt-2 font-serif italic text-[13px] text-ink-soft">No venues yet — add one from the checklist.</p>
          ) : (
            <ul className="mt-2 space-y-1">
              {venues.map((v: any) => (
                <li key={v.id} className="font-sans text-[13px] text-ink-soft">
                  <span className="text-ink">{v.name}</span>
                  {v.city ? <span className="text-clay"> · {v.city}</span> : null}
                  {v.seats ? <span className="text-clay"> · {v.seats} seats</span> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card label="Seats" value={acceptedSeats.length + (pendingSeats.length ? " · " + pendingSeats.length + " pending" : "")}>
          {seats.length === 0 ? (
            <p className="mt-2 font-serif italic text-[13px] text-ink-soft">No seats yet — invite the first person below.</p>
          ) : (
            <ul className="mt-2 space-y-1">
              {seats.slice(0, 4).map((s: any) => (
                <li key={s.id} className="font-sans text-[13px] text-ink-soft">
                  <span className="text-ink">{s.email}</span>
                  <span className="text-clay"> · {s.role}</span>
                  <span className="text-clay"> · {s.accepted_at ? "accepted" : s.revoked_at ? "revoked" : "pending"}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card label="Connections" value={conns.filter((c) => c.connected).length + " / " + conns.length}>
          <ul className="mt-2 space-y-1">
            {conns.map((c) => (
              <li key={c.key} className="font-sans text-[13px]">
                <span className={c.connected ? "text-basil" : "text-clay"}>
                  {c.connected ? "✓" : "○"} {c.label}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </section>

      {/* ─── Assistant health ─── */}
      <section className="mt-10 border-t border-line pt-6">
        <div className="flex items-baseline justify-between">
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Assistant · health</p>
          <Link href="/administrate/holdings/console/assistant" className="font-mono text-[10px] uppercase tracking-wide text-ink border-b border-ink/40 hover:border-ink pb-0.5">
            open Brain across the group →
          </Link>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-4">
          <Metric label="Tier" value={String(cfg?.billing_tier || client.tier)} sub="capitalize" />
          <Metric label="Actions MTD" value={actionsUsed.toLocaleString("en-GB")} sub={"of " + (actionsCap ? actionsCap.toLocaleString("en-GB") : "—")} />
          <Metric label="Cost MTD" value={"€" + costUsed.toFixed(2)} sub={"of €" + (costCap || "—")} />
          <Metric label="Brief today" value={brief?.date === new Date().toISOString().slice(0,10) ? "landed" : "—"} sub={brief?.date || "no brief yet"} />
        </div>
        {brief?.body ? (
          <p className="mt-4 font-serif italic text-[14px] text-ink-soft border-l-2 border-line pl-4">
            {brief.body.length > 280 ? brief.body.slice(0, 280) + "…" : brief.body}
          </p>
        ) : null}
      </section>

      {/* ─── Invite team seat ─── */}
      <section className="mt-10 border-t border-line pt-6">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Invite a team seat</p>
        <p className="mt-2 font-serif italic text-[14px] text-ink-soft">
          A magic-link goes out scoped to this client only. They see this OS in their own voice, nothing else.
        </p>
        <ClientInviteForm clientId={client.id} />
      </section>

      {/* ─── Notes ─── */}
      {client.notes ? (
        <section className="mt-10 border-t border-line pt-6">
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Notes</p>
          <p className="mt-3 font-serif text-[15px] text-ink whitespace-pre-wrap">{client.notes}</p>
        </section>
      ) : null}
    </main>
  );
}

function Card({ label, value, children }: { label: string; value: string; children?: React.ReactNode }) {
  return (
    <div className="border-t border-line pt-4">
      <p className="font-mono text-[10px] uppercase tracking-wide text-clay">{label}</p>
      <p className="mt-1 font-serif text-[22px] text-ink leading-none">{value}</p>
      {children}
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-wide text-clay">{label}</p>
      <p className="mt-1 font-serif text-[20px] text-ink leading-none">{value}</p>
      {sub ? <p className="mt-1 font-mono text-[10px] text-ink-soft">{sub}</p> : null}
    </div>
  );
}
