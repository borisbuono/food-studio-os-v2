"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

const ROLES: [string, string][] = [
  ["owner",             "Owner"],
  ["manager",           "Manager"],
  ["staff",             "Staff"],
  ["advisor_readonly",  "Advisor read-only"],
];

export default function ClientInviteForm({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole]   = useState("manager");
  const [busy, setBusy]   = useState(false);
  const [msg, setMsg]     = useState<{ ok: boolean; text: string } | null>(null);

  async function submit() {
    if (!email.trim() || !email.includes("@")) {
      setMsg({ ok: false, text: "Enter a valid email address." });
      return;
    }
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/advisor/invite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ advisory_client_id: clientId, email: email.trim().toLowerCase(), role }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || "invite failed");
      setMsg({ ok: true, text: "Invited " + email + " as " + role + ". A magic-link is on its way." });
      setEmail("");
      router.refresh();
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || "invite failed" });
    }
    setBusy(false);
  }

  const field = "w-full rounded-none border-b border-line bg-transparent px-1 py-2 font-sans text-[14px] text-ink focus:border-ink focus:outline-none";

  return (
    <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="flex-1">
        <label className="font-mono text-[10px] uppercase tracking-wide text-clay">Email</label>
        <input
          className={field}
          placeholder="michael@santagertrudis.com"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div className="w-full sm:w-52">
        <label className="font-mono text-[10px] uppercase tracking-wide text-clay">Role</label>
        <select
          className={field}
          value={role}
          onChange={(e) => setRole(e.target.value)}
        >
          {ROLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>
      <button
        onClick={submit}
        disabled={busy}
        className="font-mono text-[10px] uppercase tracking-wide text-ink border border-ink/40 hover:border-ink px-3 py-2 disabled:opacity-50"
      >
        {busy ? "sending…" : "send invite"}
      </button>
      {msg ? (
        <p className={"w-full font-sans text-[13px] " + (msg.ok ? "text-basil" : "text-tomato")}>{msg.text}</p>
      ) : null}
    </div>
  );
}
