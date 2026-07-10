"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

// The action row for the per-client dashboard: impersonate (switch entity),
// pause / reactivate the client, open the activation checklist.
//
// Impersonation follows the same pattern used elsewhere in the Assistant
// Admin — set fs_entity cookie then navigate. Advisory clients use their
// entity_code as the cookie value; the top switcher recognises ADV-* codes.

const ENTITY_TO_KEY: Record<string, string> = {
  IFL: "taller",
  BM:  "bistro_mondo",
  BBH: "holdings",
};

export default function ClientDashboardActions(props: {
  clientId: string;
  entityCode: string;
  status: string;
  checklistHref: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  function impersonate() {
    // ADV-* codes go directly as the fs_entity value — the switcher reads
    // the entity_code as its own key for advisory clients.
    const key = ENTITY_TO_KEY[props.entityCode] || props.entityCode.toLowerCase();
    document.cookie = "fs_entity=" + key + "; path=/; max-age=31536000; SameSite=Lax";
    router.push("/administrate/settings/assistant");
  }

  async function toggleStatus() {
    setBusy("status");
    const nextStatus = props.status === "paused" ? "active" : "paused";
    try {
      const r = await fetch("/api/advisor/clients/" + props.clientId, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || "failed");
      router.refresh();
    } catch (e: any) {
      alert("Could not update — " + (e?.message || "unknown"));
    }
    setBusy(null);
  }

  return (
    <div className="mt-6 flex flex-wrap items-center gap-4">
      <button
        onClick={impersonate}
        className="font-mono text-[10px] uppercase tracking-wide text-ink border border-ink/40 hover:border-ink px-3 py-1.5"
      >
        impersonate
      </button>
      <Link
        href={props.checklistHref}
        className="font-mono text-[10px] uppercase tracking-wide text-ink border-b border-ink/40 hover:border-ink pb-0.5"
      >
        activation checklist →
      </Link>
      <button
        onClick={toggleStatus}
        disabled={busy === "status"}
        className="font-mono text-[10px] uppercase tracking-wide text-ink-soft hover:text-ink border-b border-transparent hover:border-ink-soft pb-0.5 disabled:opacity-50"
      >
        {busy === "status" ? "…" : props.status === "paused" ? "reactivate client" : "pause client"}
      </button>
    </div>
  );
}
