"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const ROLE_PRESETS = [
  { role: "chef", title: "Chef de Partie" },
  { role: "sous", title: "Sous Chef" },
  { role: "line", title: "Line Cook" },
  { role: "pastry", title: "Pastry Cook" },
  { role: "waiter", title: "Waiter/Waitress" },
  { role: "bar", title: "Bartender" },
  { role: "runner", title: "Runner" },
];

export default function NewOpeningForm({ slug, entityId }: { slug: string; entityId: string }) {
  const router = useRouter();
  const [title, setTitle] = useState("Chef de Partie");
  const [role, setRole] = useState("chef");
  const [station, setStation] = useState("");
  const [hours, setHours] = useState<string>("40");
  const [rate, setRate] = useState<string>("");
  const [start, setStart] = useState("");
  const [langs, setLangs] = useState<string>("es,en");
  const [bullets, setBullets] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  function draftFromBullets() {
    const clean = bullets
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!clean.length) return;
    const body = [
      `Role: ${title}${station ? ` — ${station}` : ""}`,
      hours ? `Hours: ${hours}/week` : "",
      rate ? `Pay: €${rate}/h` : "",
      start ? `Start: ${start}` : "",
      "",
      "What we're looking for:",
      ...clean.map((b) => `• ${b}`),
    ]
      .filter(Boolean)
      .join("\n");
    setDescription(body);
  }

  async function submit() {
    setBusy(true);
    try {
      const payload = {
        entity_id: entityId,
        title: title.trim(),
        role: role || null,
        station: station.trim() || null,
        description: description || null,
        hours_per_week: hours ? Number(hours) : null,
        hourly_rate_eur: rate ? Number(rate) : null,
        start_date: start || null,
        languages_required: langs
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        status: "open",
      };
      const res = await fetch("/api/hiring/openings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) {
        alert(j.error || `HTTP ${res.status}`);
        return;
      }
      router.push(`/h/${slug}/office/hiring/${j.opening.id}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 space-y-4 text-sm">
      <div className="grid grid-cols-2 gap-2">
        <label className="col-span-2">
          <span className="text-clay text-xs">Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-0.5 w-full rounded border border-black/15 px-2 py-1.5" />
        </label>
        <label>
          <span className="text-clay text-xs">Role</span>
          <select value={role} onChange={(e) => setRole(e.target.value)} className="mt-0.5 w-full rounded border border-black/15 px-2 py-1.5">
            {ROLE_PRESETS.map((r) => (
              <option key={r.role} value={r.role}>
                {r.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="text-clay text-xs">Station / zone</span>
          <input value={station} onChange={(e) => setStation(e.target.value)} className="mt-0.5 w-full rounded border border-black/15 px-2 py-1.5" placeholder="e.g. grill" />
        </label>
        <label>
          <span className="text-clay text-xs">Hours / week</span>
          <input inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value)} className="mt-0.5 w-full rounded border border-black/15 px-2 py-1.5" />
        </label>
        <label>
          <span className="text-clay text-xs">Rate €/h</span>
          <input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} className="mt-0.5 w-full rounded border border-black/15 px-2 py-1.5" />
        </label>
        <label>
          <span className="text-clay text-xs">Start date</span>
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="mt-0.5 w-full rounded border border-black/15 px-2 py-1.5" />
        </label>
        <label>
          <span className="text-clay text-xs">Languages (comma)</span>
          <input value={langs} onChange={(e) => setLangs(e.target.value)} className="mt-0.5 w-full rounded border border-black/15 px-2 py-1.5" />
        </label>
      </div>

      <div>
        <label>
          <span className="text-clay text-xs">Bullets (one per line)</span>
          <textarea value={bullets} onChange={(e) => setBullets(e.target.value)} rows={3} className="mt-0.5 w-full rounded border border-black/15 px-2 py-1.5" />
        </label>
        <button onClick={draftFromBullets} className="mt-1 rounded border border-black/15 px-2 py-1 text-xs">
          Draft JD from bullets
        </button>
        <p className="mt-1 text-[10px] text-clay">
          Local scaffold — no AI call. Adds a heading, a hours/pay/start block, and a bulleted list.
        </p>
      </div>

      <label className="block">
        <span className="text-clay text-xs">Job description</span>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={10} className="mt-0.5 w-full rounded border border-black/15 px-2 py-1.5 font-mono text-[12px]" />
      </label>

      <div className="flex items-center justify-end gap-2">
        <button
          onClick={submit}
          disabled={busy || !title.trim()}
          className="rounded border border-black/15 bg-black px-3 py-1.5 text-xs text-white disabled:opacity-40"
        >
          {busy ? "Creating..." : "Create opening"}
        </button>
      </div>
    </div>
  );
}
