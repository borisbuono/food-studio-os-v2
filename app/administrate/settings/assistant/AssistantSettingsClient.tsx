"use client";
import { useState } from "react";

// Voice + personality + hours + playbooks + channels editor.
// Every save goes to /api/assistant/{config,playbooks,channels}.
// Editorial identity: hairlines, no cards, font-serif for prose,
// font-mono uppercase micro-copy, per-entity accent for calls to action.

type EntityCode = "IFL" | "BM" | "BBH";
type Dials = { formality: number; warmth: number; brevity: number };
type Hours = Record<string, { start: string; end: string }>;
type Playbook = { id: string; entity_code: string; name: string; description: string | null; priority: number; triage_rules: any[] };
type Channel = { id: string; user_id: string; channel_type: string; account_ref: string; auth_ref: string | null; settings: any; created_at: string; revoked_at: string | null };
type Config = { id: string; entity_code: string; voice_profile: string; personality_dials: Dials; timezone: string; working_hours: Hours; quiet_hours: { start: string; end: string } } | null;

const DAYS: [string, string][] = [
  ["mon", "Monday"], ["tue", "Tuesday"], ["wed", "Wednesday"], ["thu", "Thursday"],
  ["fri", "Friday"], ["sat", "Saturday"], ["sun", "Sunday"],
];

export default function AssistantSettingsClient(props: {
  entityCode: EntityCode;
  initialConfig: any | null;
  initialPlaybooks: Playbook[];
  initialChannels: Channel[];
}) {
  const [voice, setVoice] = useState<string>(props.initialConfig?.voice_profile || "");
  const [dials, setDials] = useState<Dials>(props.initialConfig?.personality_dials || { formality: 0.5, warmth: 0.65, brevity: 0.65 });
  const [hours, setHours] = useState<Hours>(props.initialConfig?.working_hours || DAYS.reduce((a, [k]) => ({ ...a, [k]: { start: "09:00", end: "23:00" } }), {}));
  const [quiet, setQuiet] = useState<{ start: string; end: string }>(props.initialConfig?.quiet_hours || { start: "23:30", end: "08:00" });
  const [savingCfg, setSavingCfg] = useState(false);
  const [cfgFlash, setCfgFlash] = useState<string | null>(null);

  const [playbooks, setPlaybooks] = useState<Playbook[]>(props.initialPlaybooks);
  const [drawer, setDrawer] = useState<null | Partial<Playbook>>(null);
  const [pbSaving, setPbSaving] = useState(false);

  const [channels, setChannels] = useState<Channel[]>(props.initialChannels);
  const [addChan, setAddChan] = useState<null | { channel_type: string; account_ref: string }>(null);
  const [chanBusy, setChanBusy] = useState(false);

  async function saveConfig() {
    setSavingCfg(true); setCfgFlash(null);
    try {
      const r = await fetch("/api/assistant/config", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ entity_code: props.entityCode, voice_profile: voice, personality_dials: dials, working_hours: hours, quiet_hours: quiet })});
      const d = await r.json();
      setCfgFlash(d.ok ? "Saved" : ("⚠ " + (d.error || "save failed")));
    } catch (e: any) { setCfgFlash("⚠ " + (e?.message || "save failed")); }
    setSavingCfg(false);
    setTimeout(() => setCfgFlash(null), 2500);
  }

  async function savePlaybook() {
    if (!drawer?.name) return;
    setPbSaving(true);
    try {
      const payload: any = {
        entity_code: props.entityCode,
        name: drawer.name,
        description: drawer.description || "",
        priority: typeof drawer.priority === "number" ? drawer.priority : 100,
        triage_rules: drawer.triage_rules || [],
      };
      if ((drawer as any).id) payload.id = (drawer as any).id;
      const r = await fetch("/api/assistant/playbooks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const d = await r.json();
      if (d.ok && d.playbook) {
        setPlaybooks((arr) => {
          const found = arr.findIndex((p) => p.id === d.playbook.id);
          if (found >= 0) { const nx = arr.slice(); nx[found] = d.playbook; return nx.sort((a,b)=>a.priority-b.priority); }
          return [...arr, d.playbook].sort((a,b)=>a.priority-b.priority);
        });
        setDrawer(null);
      }
    } catch {}
    setPbSaving(false);
  }

  async function deletePlaybook(id: string) {
    if (!confirm("Delete this playbook?")) return;
    const r = await fetch("/api/assistant/playbooks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, delete: true }) });
    const d = await r.json();
    if (d.ok) setPlaybooks((arr) => arr.filter((p) => p.id !== id));
  }

  async function addChannel() {
    if (!addChan?.channel_type || !addChan?.account_ref) return;
    setChanBusy(true);
    try {
      const r = await fetch("/api/assistant/channels", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(addChan) });
      const d = await r.json();
      if (d.ok && d.channel) { setChannels((arr) => [d.channel, ...arr]); setAddChan(null); }
    } catch {}
    setChanBusy(false);
  }

  async function updateChannelSettings(id: string, settings: any) {
    const r = await fetch("/api/assistant/channels", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, settings }) });
    const d = await r.json();
    if (d.ok && d.channel) setChannels((arr) => arr.map((c) => c.id === id ? d.channel : c));
  }

  async function revokeChannel(id: string) {
    if (!confirm("Disconnect this channel?")) return;
    const r = await fetch("/api/assistant/channels", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, revoke: true }) });
    const d = await r.json();
    if (d.ok) setChannels((arr) => arr.filter((c) => c.id !== id));
  }

  return (
    <>
      {/* ============================================================ */}
      {/* VOICE & PERSONALITY                                          */}
      {/* ============================================================ */}
      <section className="mt-10 border-t border-line pt-6">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Voice &amp; personality</p>
        <p className="mt-1 font-serif italic text-[14px] text-ink-soft">How the assistant speaks for this entity.</p>

        <label className="mt-4 block font-mono text-[10px] uppercase tracking-wide text-clay">Voice profile</label>
        <textarea
          value={voice} onChange={(e) => setVoice(e.target.value)}
          rows={6} maxLength={2000}
          placeholder="Describe how this entity speaks — cadence, register, house style. Example: 'Modernist and quiet. Chef-owned. Serif prose, no exclamation marks.'"
          className="mt-2 w-full resize-y rounded-none border-0 border-b border-line bg-transparent px-0 py-2 font-serif text-[16px] leading-relaxed text-ink outline-none focus:border-ink"
        />

        <div className="mt-6 grid grid-cols-1 gap-4">
          {(["formality","warmth","brevity"] as const).map((k) => (
            <div key={k}>
              <div className="flex items-baseline justify-between">
                <label className="font-mono text-[10px] uppercase tracking-wide text-clay">{k}</label>
                <span className="font-mono text-[10px] text-ink-soft">{Math.round(dials[k] * 100)}%</span>
              </div>
              <input type="range" min={0} max={1} step={0.05} value={dials[k]}
                onChange={(e) => setDials({ ...dials, [k]: Number(e.target.value) })}
                className="mt-2 w-full accent-ink" />
            </div>
          ))}
        </div>

        <div className="mt-6 flex items-baseline gap-4">
          <button onClick={saveConfig} disabled={savingCfg} style={{ background: "var(--accent)" }}
            className="rounded-full px-4 py-2 font-mono text-[10px] uppercase tracking-wide text-paper disabled:opacity-40">
            {savingCfg ? "saving…" : "save voice"}
          </button>
          {cfgFlash ? <span className="font-mono text-[10px] uppercase tracking-wide text-clay">{cfgFlash}</span> : null}
        </div>
      </section>

      {/* ============================================================ */}
      {/* WORKING HOURS + QUIET HOURS                                  */}
      {/* ============================================================ */}
      <section className="mt-12 border-t border-line pt-6">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Working hours</p>
        <p className="mt-1 font-serif italic text-[14px] text-ink-soft">When the assistant may draft, brief, or reach out on this entity's behalf.</p>

        <div className="mt-4 grid grid-cols-1 gap-2">
          {DAYS.map(([k, label]) => (
            <div key={k} className="grid grid-cols-[100px_1fr_auto_1fr] items-baseline gap-3 border-b border-line pb-2">
              <span className="font-serif text-[14px] text-ink">{label}</span>
              <input type="time" value={hours[k]?.start || "09:00"}
                onChange={(e) => setHours({ ...hours, [k]: { start: e.target.value, end: hours[k]?.end || "23:00" } })}
                className="border-0 border-b border-line bg-transparent px-0 py-1 font-mono text-[12px] text-ink outline-none focus:border-ink" />
              <span className="font-mono text-[10px] text-clay">→</span>
              <input type="time" value={hours[k]?.end || "23:00"}
                onChange={(e) => setHours({ ...hours, [k]: { start: hours[k]?.start || "09:00", end: e.target.value } })}
                className="border-0 border-b border-line bg-transparent px-0 py-1 font-mono text-[12px] text-ink outline-none focus:border-ink" />
            </div>
          ))}
        </div>

        <p className="mt-6 font-mono text-[10px] uppercase tracking-wide text-clay">Quiet hours override</p>
        <div className="mt-2 flex items-baseline gap-3">
          <input type="time" value={quiet.start} onChange={(e) => setQuiet({ ...quiet, start: e.target.value })}
            className="border-0 border-b border-line bg-transparent px-0 py-1 font-mono text-[12px] text-ink outline-none focus:border-ink" />
          <span className="font-mono text-[10px] text-clay">→</span>
          <input type="time" value={quiet.end} onChange={(e) => setQuiet({ ...quiet, end: e.target.value })}
            className="border-0 border-b border-line bg-transparent px-0 py-1 font-mono text-[12px] text-ink outline-none focus:border-ink" />
        </div>

        <div className="mt-6">
          <button onClick={saveConfig} disabled={savingCfg} style={{ background: "var(--accent)" }}
            className="rounded-full px-4 py-2 font-mono text-[10px] uppercase tracking-wide text-paper disabled:opacity-40">
            {savingCfg ? "saving…" : "save hours"}
          </button>
        </div>
      </section>

      {/* ============================================================ */}
      {/* PLAYBOOKS                                                    */}
      {/* ============================================================ */}
      <section className="mt-12 border-t border-line pt-6">
        <div className="flex items-baseline justify-between">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Playbooks</p>
            <p className="mt-1 font-serif italic text-[14px] text-ink-soft">Named triage rulesets, priority-ordered. The assistant walks them when handling inbound.</p>
          </div>
          <button onClick={() => setDrawer({ name: "", description: "", priority: 100, triage_rules: [] })}
            className="font-mono text-[10px] uppercase tracking-wide" style={{ color: "var(--accent)" }}>+ add</button>
        </div>

        {!playbooks.length ? (
          <p className="mt-6 font-serif italic text-[14px] text-muted">
            No playbooks yet. Start with one — for example, a Supplier-invoice playbook that files EU VAT invoices to the recovery queue and English tourist requests to the concierge.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-line border-t border-line">
            {playbooks.map((p) => (
              <li key={p.id} className="flex items-baseline justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="font-serif text-[15px] text-ink">{p.name}</p>
                  {p.description ? <p className="mt-0.5 font-serif italic text-[13px] text-ink-soft">{p.description}</p> : null}
                  <p className="mt-0.5 font-mono text-[10px] text-clay">priority {p.priority} · {(p.triage_rules || []).length} rule{(p.triage_rules || []).length === 1 ? "" : "s"}</p>
                </div>
                <div className="flex items-baseline gap-3">
                  <button onClick={() => setDrawer({ ...p, triage_rules: p.triage_rules || [] })}
                    className="font-mono text-[10px] uppercase tracking-wide text-clay hover:text-ink">edit</button>
                  <button onClick={() => deletePlaybook(p.id)}
                    className="font-mono text-[10px] uppercase tracking-wide text-clay hover:text-tomato">delete</button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {drawer ? (
          <div className="mt-4 border-t border-line pt-4">
            <p className="font-mono text-[10px] uppercase tracking-wide text-clay">{ (drawer as any).id ? "Edit playbook" : "New playbook" }</p>
            <div className="mt-3 grid grid-cols-1 gap-3">
              <input value={drawer.name || ""} onChange={(e) => setDrawer({ ...drawer, name: e.target.value })}
                placeholder="Name"
                className="border-0 border-b border-line bg-transparent px-0 py-2 font-serif text-[15px] text-ink outline-none focus:border-ink" />
              <textarea value={drawer.description || ""} onChange={(e) => setDrawer({ ...drawer, description: e.target.value })}
                placeholder="What this playbook covers (one sentence)"
                rows={2}
                className="resize-y border-0 border-b border-line bg-transparent px-0 py-2 font-serif italic text-[14px] text-ink-soft outline-none focus:border-ink" />
              <div className="flex items-baseline gap-3">
                <label className="font-mono text-[10px] uppercase tracking-wide text-clay">Priority</label>
                <input type="number" value={drawer.priority ?? 100}
                  onChange={(e) => setDrawer({ ...drawer, priority: Number(e.target.value) })}
                  className="w-24 border-0 border-b border-line bg-transparent px-0 py-1 font-mono text-[12px] text-ink outline-none focus:border-ink" />
                <span className="font-mono text-[10px] text-muted">lower = higher priority</span>
              </div>
              <div>
                <label className="font-mono text-[10px] uppercase tracking-wide text-clay">Triage rules (JSON)</label>
                <textarea
                  value={JSON.stringify(drawer.triage_rules || [], null, 2)}
                  onChange={(e) => { try { setDrawer({ ...drawer, triage_rules: JSON.parse(e.target.value) }); } catch {} }}
                  rows={6}
                  placeholder='[{"match":{"from":"@supplier.com"},"action":"file_to_finance"}]'
                  className="mt-2 w-full resize-y border-0 border-b border-line bg-transparent px-0 py-2 font-mono text-[11px] text-ink outline-none focus:border-ink" />
              </div>
              <div className="flex items-baseline gap-3">
                <button onClick={savePlaybook} disabled={pbSaving || !drawer.name}
                  style={{ background: "var(--accent)" }}
                  className="rounded-full px-4 py-2 font-mono text-[10px] uppercase tracking-wide text-paper disabled:opacity-40">
                  {pbSaving ? "saving…" : "save"}
                </button>
                <button onClick={() => setDrawer(null)}
                  className="font-mono text-[10px] uppercase tracking-wide text-clay hover:text-ink">cancel</button>
              </div>
            </div>
          </div>
        ) : null}
      </section>

      {/* ============================================================ */}
      {/* CHANNELS                                                     */}
      {/* ============================================================ */}
      <section className="mt-12 border-t border-line pt-6">
        <div className="flex items-baseline justify-between">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Channels</p>
            <p className="mt-1 font-serif italic text-[14px] text-ink-soft">Where the assistant may read + draft on your behalf. You connect them one at a time.</p>
          </div>
          <button onClick={() => setAddChan({ channel_type: "gmail", account_ref: "" })}
            className="font-mono text-[10px] uppercase tracking-wide" style={{ color: "var(--accent)" }}>+ add</button>
        </div>

        {!channels.length ? (
          <p className="mt-6 font-serif italic text-[14px] text-muted">
            No channels yet. Connect Gmail or a WhatsApp number and the assistant can begin drafting replies for your review.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-line border-t border-line">
            {channels.map((c) => {
              const settings = c.settings || {};
              return (
                <li key={c.id} className="py-4">
                  <div className="flex items-baseline justify-between gap-4">
                    <div>
                      <p className="font-serif text-[15px] text-ink">{c.account_ref}</p>
                      <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wide text-clay">{c.channel_type.replace("_", " ")}</p>
                    </div>
                    <button onClick={() => revokeChannel(c.id)}
                      className="font-mono text-[10px] uppercase tracking-wide text-clay hover:text-tomato">disconnect</button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-3">
                    <label className="flex items-baseline gap-2">
                      <input type="checkbox" checked={!!settings.triage_enabled}
                        onChange={(e) => updateChannelSettings(c.id, { ...settings, triage_enabled: e.target.checked })} />
                      <span className="font-mono text-[10px] uppercase tracking-wide text-ink">Triage enabled</span>
                    </label>
                    <label className="flex items-baseline gap-2">
                      <input type="radio" name={`send-${c.id}`} checked={!!settings.auto_draft && !settings.supervised_send}
                        onChange={() => updateChannelSettings(c.id, { ...settings, auto_draft: true, supervised_send: false })} />
                      <span className="font-mono text-[10px] uppercase tracking-wide text-ink">Draft only</span>
                    </label>
                    <label className="flex items-baseline gap-2">
                      <input type="radio" name={`send-${c.id}`} checked={!!settings.supervised_send}
                        onChange={() => updateChannelSettings(c.id, { ...settings, auto_draft: true, supervised_send: true })} />
                      <span className="font-mono text-[10px] uppercase tracking-wide text-ink">Supervised send</span>
                    </label>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {addChan ? (
          <div className="mt-4 border-t border-line pt-4">
            <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Connect a channel</p>
            <div className="mt-3 grid grid-cols-1 gap-3">
              <select value={addChan.channel_type} onChange={(e) => setAddChan({ ...addChan, channel_type: e.target.value })}
                className="border-0 border-b border-line bg-transparent px-0 py-2 font-serif text-[15px] text-ink outline-none focus:border-ink">
                <option value="gmail">Gmail</option>
                <option value="whatsapp_personal">WhatsApp — personal</option>
                <option value="whatsapp_business">WhatsApp — business</option>
              </select>
              <input value={addChan.account_ref} onChange={(e) => setAddChan({ ...addChan, account_ref: e.target.value })}
                placeholder={addChan.channel_type === "gmail" ? "you@yourdomain.com" : "+34 600 000 000"}
                className="border-0 border-b border-line bg-transparent px-0 py-2 font-serif text-[15px] text-ink outline-none focus:border-ink" />
              <p className="font-mono text-[10px] uppercase tracking-wide text-muted">
                OAuth / device pairing lands in Sprints 3–4 (Email + WhatsApp edge connectors). For now this records the account so the playbook editor can reference it.
              </p>
              <div className="flex items-baseline gap-3">
                <button onClick={addChannel} disabled={chanBusy || !addChan.account_ref}
                  style={{ background: "var(--accent)" }}
                  className="rounded-full px-4 py-2 font-mono text-[10px] uppercase tracking-wide text-paper disabled:opacity-40">
                  {chanBusy ? "adding…" : "add channel"}
                </button>
                <button onClick={() => setAddChan(null)}
                  className="font-mono text-[10px] uppercase tracking-wide text-clay hover:text-ink">cancel</button>
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </>
  );
}
