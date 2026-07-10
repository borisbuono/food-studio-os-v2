"use client";
import { useMemo, useState } from "react";
import { ADVISORY_TEMPLATES } from "@/lib/advisory/templates";
import { useRouter } from "next/navigation";

// The six-step wizard. State is held here — a single POST to
// /api/assistant/onboard finishes the job.
//
// The copy is deliberately prose. No bullets in the surface. When we do
// present options (tiers, playbooks), they appear as short prose lines
// with a small mono label, not as list bullets.

type Tier = { name: string; monthly_action_cap: number; monthly_cost_cap_eur: number; features: Record<string, boolean> };
type AdvClient = { entity_code: string; name: string; city: string | null; country: string | null };

const DAYS: [string, string][] = [
  ["mon","Monday"], ["tue","Tuesday"], ["wed","Wednesday"], ["thu","Thursday"],
  ["fri","Friday"], ["sat","Saturday"], ["sun","Sunday"],
];

const SEED_PLAYBOOKS = [
  {
    name: "Bookings before anything else",
    description:
      "A reservation, a change, a cancellation — the front of house feels it first. These threads jump to the top.",
    priority: 10,
    triage_rules: [
      { match: "subject_or_body_contains", any: ["booking","reservation","cancel","change","table","guests","reservar","reserva"] },
      { assign: { priority: 1, category: "bookings", suggested_action: "draft_reply" } },
    ],
  },
  {
    name: "Suppliers and invoices",
    description:
      "Statements, invoices, delivery confirmations. Draft a short reply when a supplier writes; forward the invoice to the scan inbox.",
    priority: 20,
    triage_rules: [
      { match: "subject_or_body_contains", any: ["invoice","factura","albarán","payment","overdue","supplier","proveedor"] },
      { assign: { priority: 2, category: "suppliers", suggested_action: "flag" } },
    ],
  },
  {
    name: "Projects and partners",
    description:
      "Everything happening around the venue that isn't service — press, investors, landlords, tradesmen. Priority 3, drafted for a second read.",
    priority: 40,
    triage_rules: [
      { match: "subject_or_body_contains", any: ["contract","proposal","proyecto","project","landlord","press","interview"] },
      { assign: { priority: 3, category: "projects", suggested_action: "draft_reply" } },
    ],
  },
  {
    name: "Personal, treated last",
    description:
      "Newsletters, receipts, personal notes. Kept out of the way — they will not be surfaced during service.",
    priority: 90,
    triage_rules: [
      { match: "subject_or_body_contains", any: ["newsletter","unsubscribe","receipt","confirm your"] },
      { assign: { priority: 5, category: "personal", suggested_action: "no_action" } },
    ],
  },
];

const DEFAULT_HOURS = DAYS.reduce((a, [k]) => ({ ...a, [k]: { start: "09:00", end: "23:00" } }), {} as Record<string, { start: string; end: string }>);

export default function OnboardWizardClient(props: {
  deepEntity: string;
  configuredCodes: string[];
  advClients: AdvClient[];
  tiers: Tier[];
}) {
  const router = useRouter();

  // Step 1 — entity picker.
  const startingMode: "existing" | "new" =
    props.deepEntity === "NEW" ? "new" : "existing";
  const [mode, setMode] = useState<"existing"|"new">(startingMode);
  const [entityCode, setEntityCode] = useState<string>(
    props.deepEntity && props.deepEntity !== "NEW" ? props.deepEntity : "IFL"
  );
  const [advName, setAdvName]   = useState("");
  const [advCity, setAdvCity]   = useState("");
  const [advCountry, setAdvCountry] = useState("Spain");
  const [advFiscalName, setAdvFiscalName] = useState("");
  const [advCif, setAdvCif] = useState("");
  const [advEmail, setAdvEmail] = useState("");
  const [advPhone, setAdvPhone] = useState("");
  const [templateKey, setTemplateKey] = useState<string>("blank");

  // Apply a template — prefill voice, dials, tier, playbooks. Additive:
  // the advisor can still edit anything in the later steps.
  function applyTemplate(key: string) {
    setTemplateKey(key);
    const t = ADVISORY_TEMPLATES.find((tpl) => tpl.key === key);
    if (!t) return;
    setVoice(t.voice_profile);
    setDials(t.personality_dials);
    setTimezone(t.timezone);
    setPlaybooks(t.playbooks.map((p) => ({ ...p, enabled: true })));
    setTier(t.suggested_tier);
  }

  // Step 2 — voice + dials.
  const [voice, setVoice] = useState("");
  const [dials, setDials] = useState({ formality: 0.5, warmth: 0.65, brevity: 0.6 });

  // Step 3 — timezone + hours.
  const [timezone, setTimezone] = useState("Europe/Madrid");
  const [hours, setHours] = useState(DEFAULT_HOURS);

  // Step 4 — playbooks (starts pre-seeded).
  const [playbooks, setPlaybooks] = useState(SEED_PLAYBOOKS.map((p) => ({ ...p, enabled: true })));

  // Step 5 — channels are optional; we surface the buttons only.
  // (Actual OAuth happens in Assistant Settings after finish — the wizard
  // just seeds the profile.)

  // Step 6 — billing tier.
  const [tier, setTier] = useState(props.tiers.find((t) => t.name === "pro")?.name || "pro");

  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<null | { entity_code: string; tier: string }>(null);

  const enabledPlaybooks = useMemo(() => playbooks.filter((p) => p.enabled), [playbooks]);

  async function finish() {
    setBusy(true); setErr(null);
    try {
      const payload: any = {
        voice_profile: voice,
        personality_dials: dials,
        timezone,
        working_hours: hours,
        playbooks: enabledPlaybooks.map(({ enabled, ...rest }) => rest),
        billing_tier: tier,
      };
      if (mode === "new") {
        payload.entity_code = "NEW";
        payload.advisory = {
          name: advName,
          city: advCity || null,
          country: advCountry || null,
          fiscal_name: advFiscalName || null,
          cif: advCif || null,
          contact_email: advEmail || null,
          contact_phone: advPhone || null,
        };
        payload.template_key = templateKey;
      } else {
        payload.entity_code = entityCode;
      }
      const r = await fetch("/api/assistant/onboard", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || "onboarding failed");
      setDone({ entity_code: d.entity_code, tier: d.tier });
    } catch (e: any) {
      setErr(e?.message || "onboarding failed");
    }
    setBusy(false);
  }

  if (done) {
    return (
      <section className="mt-10 border-t border-black/10 pt-8">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Onboarded</p>
        <h2 className="mt-2 font-serif text-[22px] text-ink">{done.entity_code} is ready.</h2>
        <p className="mt-3 font-serif italic text-[15px] text-ink-soft">
          The profile has a voice, a working day, a set of playbooks and a welcome brief. Open Assistant Settings to
          connect Gmail or WhatsApp when you have a spare minute — nothing is sent without you.
        </p>
        <div className="mt-6 flex items-center gap-4">
          <button
            onClick={() => router.push("/administrate/settings/assistant")}
            className="font-mono text-[10px] uppercase tracking-wide text-ink border-b border-ink/40 hover:border-ink pb-0.5">
            open assistant settings
          </button>
          <span className="font-mono text-[10px] uppercase tracking-wide text-clay">tier · {done.tier}</span>
        </div>
      </section>
    );
  }

  return (
    <section className="mt-10 border-t border-black/10 pt-8">
      <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Step {step} of 6</p>

      {step === 1 && (
        <div className="mt-4">
          <h2 className="font-serif text-[22px] text-ink">Whose second brain are we shaping?</h2>
          <p className="mt-3 font-serif italic text-[15px] text-ink-soft">
            Choose one of the three profiles inside the group, or spin up an advisory client — a new white-label
            profile that lives alongside yours with its own voice and its own drawer of numbers.
          </p>
          <div className="mt-6 space-y-4">
            <label className="block">
              <span className="font-mono text-[10px] uppercase tracking-wide text-clay">Existing profile</span>
              <div className="mt-1 flex items-center gap-3">
                <input type="radio" checked={mode==="existing"} onChange={() => setMode("existing")} />
                <select
                  disabled={mode!=="existing"}
                  value={entityCode}
                  onChange={(e) => setEntityCode(e.target.value)}
                  className="font-serif text-[16px] bg-transparent border-b border-black/20 py-1">
                  <option value="IFL">Taller Sa Penya (IFL)</option>
                  <option value="BM">Bistro Mondo (BM)</option>
                  <option value="BBH">Boris Buono Holdings (BBH)</option>
                  {props.advClients.map((a) => (
                    <option key={a.entity_code} value={a.entity_code}>{a.name} ({a.entity_code})</option>
                  ))}
                </select>
              </div>
            </label>
            <label className="block">
              <span className="font-mono text-[10px] uppercase tracking-wide text-clay">Advisory client</span>
              <div className="mt-1 flex items-center gap-3">
                <input type="radio" checked={mode==="new"} onChange={() => setMode("new")} />
                <input
                  disabled={mode!=="new"}
                  value={advName}
                  onChange={(e) => setAdvName(e.target.value)}
                  placeholder="Restaurant name"
                  className="font-serif text-[16px] bg-transparent border-b border-black/20 py-1 min-w-[240px]" />
              </div>
              {mode==="new" && (
                <div className="mt-3 space-y-3">
                  <div className="flex items-center gap-3">
                    <input value={advCity} onChange={(e) => setAdvCity(e.target.value)} placeholder="City" className="font-serif text-[15px] bg-transparent border-b border-black/20 py-1" />
                    <input value={advCountry} onChange={(e) => setAdvCountry(e.target.value)} placeholder="Country" className="font-serif text-[15px] bg-transparent border-b border-black/20 py-1" />
                  </div>
                  <div className="flex items-center gap-3">
                    <input value={advFiscalName} onChange={(e) => setAdvFiscalName(e.target.value)} placeholder="Fiscal name (optional)" className="font-serif text-[15px] bg-transparent border-b border-black/20 py-1 min-w-[240px]" />
                    <input value={advCif} onChange={(e) => setAdvCif(e.target.value)} placeholder="CIF (optional)" className="font-serif text-[15px] bg-transparent border-b border-black/20 py-1" />
                  </div>
                  <div className="flex items-center gap-3">
                    <input value={advEmail} onChange={(e) => setAdvEmail(e.target.value)} placeholder="Contact email" className="font-serif text-[15px] bg-transparent border-b border-black/20 py-1 min-w-[240px]" />
                    <input value={advPhone} onChange={(e) => setAdvPhone(e.target.value)} placeholder="Contact phone" className="font-serif text-[15px] bg-transparent border-b border-black/20 py-1" />
                  </div>
                </div>
              )}
            </label>
          </div>

          {mode === "new" && (
            <div className="mt-8 border-t border-black/10 pt-6">
              <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Pick a template</p>
              <p className="mt-2 font-serif italic text-[14px] text-ink-soft">
                A template pre-fills voice, playbooks and a menu skeleton. You can edit anything in the next steps.
              </p>
              <div className="mt-4 divide-y divide-black/10">
                {ADVISORY_TEMPLATES.map((t) => (
                  <label key={t.key} className="flex items-start gap-3 py-4 cursor-pointer">
                    <input type="radio" checked={templateKey===t.key} onChange={() => applyTemplate(t.key)} className="mt-1" />
                    <div className="flex-1">
                      <p className="font-serif text-[16px] text-ink">{t.label}</p>
                      <p className="mt-1 font-serif italic text-[13px] text-ink-soft">{t.short_description}</p>
                      <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-clay">
                        {t.suggested_tier} tier · {t.playbooks.length} playbook{t.playbooks.length===1?"":"s"} · {t.common_suppliers.length ? t.common_suppliers.length + " supplier seeds" : "no supplier seeds"}
                      </p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="mt-4">
          <h2 className="font-serif text-[22px] text-ink">Now the voice.</h2>
          <p className="mt-3 font-serif italic text-[15px] text-ink-soft">
            One paragraph — the voice you want the Assistant to write in when it drafts on your behalf. Think of it as
            handing a house style to a new writer. The three sliders below tune the temperature of every reply.
          </p>
          <textarea
            value={voice}
            onChange={(e) => setVoice(e.target.value)}
            rows={5}
            placeholder="Warm and modernist. Chef-owned. Serif prose, hairlines not exclamation marks..."
            className="mt-4 w-full font-serif text-[16px] bg-transparent border-b border-black/20 py-2" />
          <div className="mt-6 space-y-4">
            {(["formality","warmth","brevity"] as const).map((k) => (
              <label key={k} className="block">
                <div className="flex justify-between font-mono text-[10px] uppercase tracking-wide text-clay">
                  <span>{k}</span><span>{(dials[k]*100).toFixed(0)}%</span>
                </div>
                <input
                  type="range" min={0} max={1} step={0.05}
                  value={dials[k]}
                  onChange={(e) => setDials({ ...dials, [k]: Number(e.target.value) })}
                  className="w-full" />
              </label>
            ))}
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="mt-4">
          <h2 className="font-serif text-[22px] text-ink">When does the day begin?</h2>
          <p className="mt-3 font-serif italic text-[15px] text-ink-soft">
            The Assistant respects working hours. It writes the morning brief inside them, holds drafts back outside
            them, and never taps you on the shoulder in the quiet part of the night.
          </p>
          <label className="mt-4 block">
            <span className="font-mono text-[10px] uppercase tracking-wide text-clay">Timezone</span>
            <input value={timezone} onChange={(e) => setTimezone(e.target.value)}
              className="mt-1 font-serif text-[16px] bg-transparent border-b border-black/20 py-1" />
          </label>
          <div className="mt-6 space-y-2">
            {DAYS.map(([k, label]) => (
              <div key={k} className="flex items-center gap-4">
                <span className="font-mono text-[10px] uppercase tracking-wide text-clay w-24">{label}</span>
                <input type="time" value={hours[k].start} onChange={(e) => setHours({ ...hours, [k]: { ...hours[k], start: e.target.value } })}
                  className="font-mono text-[12px] bg-transparent border-b border-black/20 py-1" />
                <span className="text-clay">→</span>
                <input type="time" value={hours[k].end} onChange={(e) => setHours({ ...hours, [k]: { ...hours[k], end: e.target.value } })}
                  className="font-mono text-[12px] bg-transparent border-b border-black/20 py-1" />
              </div>
            ))}
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="mt-4">
          <h2 className="font-serif text-[22px] text-ink">The rules that decide which mail matters.</h2>
          <p className="mt-3 font-serif italic text-[15px] text-ink-soft">
            These are the playbooks the Assistant reads before it triages your inbox. Bookings come before suppliers,
            suppliers before projects, projects before personal. Toggle a rule off if it does not apply — you can
            always add more later in Assistant Settings.
          </p>
          <div className="mt-4 divide-y divide-black/10">
            {playbooks.map((p, i) => (
              <div key={p.name} className="py-4">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={p.enabled}
                    onChange={(e) => {
                      const nx = playbooks.slice();
                      nx[i] = { ...p, enabled: e.target.checked };
                      setPlaybooks(nx);
                    }} />
                  <p className="font-serif text-[16px] text-ink">{p.name}</p>
                  <span className="font-mono text-[10px] uppercase tracking-wide text-clay">priority {p.priority}</span>
                </div>
                <p className="mt-1 pl-6 font-serif italic text-[14px] text-ink-soft">{p.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {step === 5 && (
        <div className="mt-4">
          <h2 className="font-serif text-[22px] text-ink">Channels come later, if at all.</h2>
          <p className="mt-3 font-serif italic text-[15px] text-ink-soft">
            The Assistant does not need to touch your inbox to be useful — the morning brief and the FAB will work on
            day one. When you are ready, connect Gmail from Assistant Settings and it will draft replies for you to
            approve. WhatsApp is the same story. Nothing is sent without you.
          </p>
          <p className="mt-6 font-mono text-[10px] uppercase tracking-wide text-clay">You can skip this step.</p>
        </div>
      )}

      {step === 6 && (
        <div className="mt-4">
          <h2 className="font-serif text-[22px] text-ink">Which tier fits this profile?</h2>
          <p className="mt-3 font-serif italic text-[15px] text-ink-soft">
            The tier sets the monthly ceiling — how many actions the Assistant can run, how much it can spend on
            models, and which features it can reach. You can change it any time.
          </p>
          <div className="mt-6 divide-y divide-black/10">
            {props.tiers.map((t) => (
              <label key={t.name} className="flex items-start gap-3 py-4 cursor-pointer">
                <input type="radio" checked={tier===t.name} onChange={() => setTier(t.name)} className="mt-1" />
                <div className="flex-1">
                  <p className="font-serif text-[17px] text-ink capitalize">{t.name}</p>
                  <p className="mt-1 font-serif italic text-[14px] text-ink-soft">
                    Up to {t.monthly_action_cap.toLocaleString("en-GB")} actions a month, ceiling €{Number(t.monthly_cost_cap_eur).toFixed(0)} in model spend.
                    {t.features?.email_triage ? " Email triage included." : ""}
                    {t.features?.wa_business ? " WhatsApp Business Cloud included." : ""}
                    {t.features?.multi_user ? " Multiple operators can share the profile." : ""}
                  </p>
                </div>
              </label>
            ))}
          </div>
        </div>
      )}

      {err && (
        <p className="mt-6 font-mono text-[11px] uppercase tracking-wide text-tomato">{err}</p>
      )}

      <div className="mt-10 flex items-center justify-between border-t border-black/10 pt-6">
        <button
          disabled={step===1 || busy}
          onClick={() => setStep(step - 1)}
          className="font-mono text-[10px] uppercase tracking-wide text-clay disabled:opacity-30">
          ← back
        </button>
        {step < 6 ? (
          <button
            disabled={busy || (step===1 && mode==="new" && !advName.trim())}
            onClick={() => setStep(step + 1)}
            className="font-mono text-[10px] uppercase tracking-wide text-ink border-b border-ink/40 hover:border-ink pb-0.5 disabled:opacity-30">
            continue →
          </button>
        ) : (
          <button
            disabled={busy || (mode==="new" && !advName.trim())}
            onClick={finish}
            className="font-mono text-[10px] uppercase tracking-wide text-ink border-b border-ink hover:border-ink pb-0.5 disabled:opacity-30">
            {busy ? "shaping the profile…" : "finish onboarding"}
          </button>
        )}
      </div>
    </section>
  );
}
