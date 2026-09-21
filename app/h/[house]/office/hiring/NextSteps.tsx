"use client";

// After the interview: keep someone in the pool for later, hire them onto the
// team (team_members + onboarding membership), then walk the contract pack to
// the gestoría. Or erase them (GDPR request / test rows).

import { useEffect, useState } from "react";

type C = {
  id: string;
  name: string;
  status: string;
  email?: string | null;
  phone?: string | null;
  team_member_id?: string | null;
  answers?: any;
};

const CONTRACT_TYPES = ["Indefinido", "Fijo discontinuo", "Temporal", "Extras / por horas", "Stage formativo"];
const STAGES: Array<[string, string]> = [
  ["to_prepare", "To prepare"],
  ["sent_to_gestoria", "Sent to gestoría"],
  ["signed", "Signed"],
  ["alta_done", "Alta done — active"],
];
const DOCS: Array<[string, string]> = [
  ["dni_nie", "DNI / NIE copy"],
  ["nss", "Social Security no."],
  ["iban", "IBAN"],
  ["address", "Address"],
  ["carnet_manipulador", "Carnet manipulador"],
];

export default function NextSteps({ c, onCandidate }: { c: C; onCandidate: (c: any) => void }) {
  const [busy, setBusy] = useState(false);
  const [hireOpen, setHireOpen] = useState(false);
  const [role, setRole] = useState(c.answers?.area === "sala" ? "worker" : "worker");
  const [start, setStart] = useState("");
  const [m, setM] = useState<any>(null);
  const [k, setK] = useState<any>(null);

  useEffect(() => {
    if (!c.team_member_id) return;
    (async () => {
      const r = await fetch(`/api/hiring/candidates/${c.id}/contract`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (j.ok && j.membership) {
        setM(j.membership);
        setK(j.membership.metadata?.contract || {});
      }
    })();
  }, [c.id, c.team_member_id]);

  async function toPool() {
    setBusy(true);
    try {
      const r = await fetch(`/api/hiring/candidates/${c.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "pool", reason: "kept for later" }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) return alert(j.error || "failed");
      onCandidate(j.candidate);
    } finally {
      setBusy(false);
    }
  }

  async function hire() {
    setBusy(true);
    try {
      const r = await fetch(`/api/hiring/candidates/${c.id}/to-team`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, start_date: start || undefined }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) return alert(j.error || "failed");
      onCandidate({ ...c, status: "hired", team_member_id: j.team_member_id });
      setHireOpen(false);
    } finally {
      setBusy(false);
    }
  }

  async function erase() {
    if (!window.confirm(`Delete ${c.name} completely — CV, answers, history? This can't be undone.`)) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/hiring/candidates/${c.id}`, { method: "DELETE" });
      const j = await r.json();
      if (!r.ok || !j.ok) return alert(j.error || "failed");
      window.location.reload();
    } finally {
      setBusy(false);
    }
  }

  async function saveContract(next: any) {
    setK(next);
    const r = await fetch(`/api/hiring/candidates/${c.id}/contract`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contract: next }),
    });
    const j = await r.json();
    if (!r.ok || !j.ok) return alert(j.error || "failed");
    setM(j.membership);
  }

  function copyForGestoria() {
    const docsMissing = DOCS.filter(([d]) => !k?.docs?.[d]).map(([, l]) => l);
    const text = [
      `Alta nueva — ${c.name}`,
      `Email: ${c.email || "—"} · Tel: ${c.phone || "—"}`,
      `Puesto: ${m?.role || "—"} (${m?.area === "foh" ? "sala" : "cocina"})`,
      `Inicio: ${k?.start_date || "—"}`,
      `Contrato: ${k?.contract_type || "—"} · ${k?.hours_per_week ?? "—"} h/semana · ${k?.gross_salary || "—"}`,
      docsMissing.length ? `Documentación pendiente: ${docsMissing.join(", ")}` : "Documentación: completa",
      k?.notes ? `Notas: ${k.notes}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    navigator.clipboard.writeText(text);
  }

  const box = "mt-4 rounded border border-black/10 p-3 text-xs";
  const btn = "rounded border border-black/15 px-2 py-1";

  if (c.team_member_id && k) {
    return (
      <div className={box}>
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-clay">On the team · contract</h4>
        <p className="mt-1 text-clay">
          Membership: {m?.role} · {m?.area} · {m?.status}. No invitation to the OS has been sent.
        </p>
        <div className="mt-2 flex flex-wrap gap-1">
          {STAGES.map(([v, l]) => (
            <button
              key={v}
              onClick={() => saveContract({ ...k, stage: v })}
              className={`${btn} ${k.stage === v ? "bg-black text-white" : ""}`}
            >
              {l}
            </button>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          <label>
            Start
            <input type="date" className="mt-0.5 w-full rounded border border-black/15 px-1.5 py-1" value={k.start_date || ""} onChange={(e) => saveContract({ ...k, start_date: e.target.value })} />
          </label>
          <label>
            Contract
            <select className="mt-0.5 w-full rounded border border-black/15 px-1.5 py-1" value={k.contract_type || ""} onChange={(e) => saveContract({ ...k, contract_type: e.target.value })}>
              <option value="">—</option>
              {CONTRACT_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label>
            Hours / week
            <input type="number" className="mt-0.5 w-full rounded border border-black/15 px-1.5 py-1" value={k.hours_per_week ?? ""} onChange={(e) => setK({ ...k, hours_per_week: e.target.value === "" ? null : Number(e.target.value) })} onBlur={() => saveContract(k)} />
          </label>
          <label>
            Gross salary
            <input className="mt-0.5 w-full rounded border border-black/15 px-1.5 py-1" placeholder="e.g. 1.900 €/mes bruto" value={k.gross_salary || ""} onChange={(e) => setK({ ...k, gross_salary: e.target.value })} onBlur={() => saveContract(k)} />
          </label>
        </div>
        <div className="mt-2">
          <div className="text-clay">Documents received by the gestoría (tick only — never type them here):</div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
            {DOCS.map(([d, l]) => (
              <label key={d} className="flex items-center gap-1">
                <input type="checkbox" checked={!!k.docs?.[d]} onChange={(e) => saveContract({ ...k, docs: { ...(k.docs || {}), [d]: e.target.checked } })} />
                {l}
              </label>
            ))}
          </div>
        </div>
        <textarea className="mt-2 w-full rounded border border-black/15 px-2 py-1" rows={2} placeholder="notes" value={k.notes || ""} onChange={(e) => setK({ ...k, notes: e.target.value })} onBlur={() => saveContract(k)} />
        <button onClick={copyForGestoria} className={`${btn} mt-1`}>
          Copy summary for the gestoría
        </button>
      </div>
    );
  }

  if (c.team_member_id) return null;

  return (
    <div className={box}>
      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-clay">Decision</h4>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button disabled={busy} onClick={() => setHireOpen((v) => !v)} className={`${btn} bg-black text-white`}>
          Hire → team
        </button>
        {c.status !== "pool" ? (
          <button disabled={busy} onClick={toPool} className={btn}>
            Keep in pool for later
          </button>
        ) : null}
        <button disabled={busy} onClick={erase} className={`${btn} text-red-700`}>
          Delete (GDPR / test)
        </button>
      </div>
      {hireOpen ? (
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          <label>
            Role
            <select className="mt-0.5 w-full rounded border border-black/15 px-1.5 py-1" value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="worker">Team (cook / waiter)</option>
              <option value="chef">Chef</option>
              <option value="maitre">Maître</option>
              <option value="manager">Manager</option>
            </select>
          </label>
          <label>
            Start date
            <input type="date" className="mt-0.5 w-full rounded border border-black/15 px-1.5 py-1" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <button disabled={busy} onClick={hire} className={`${btn} col-span-2 bg-black text-white`}>
            Create team member + start contract pack
          </button>
          <p className="col-span-2 text-clay">Creates the person in your team and a contract checklist. Sends nothing to the candidate.</p>
        </div>
      ) : null}
    </div>
  );
}
