"use client";
import { useState } from "react";

// Manager tool: delete CV files no candidate points to (deleted tests, failed submissions).
export default function PurgeCvs({ entityId }: { entityId: string }) {
  const [msg, setMsg] = useState("");
  return (
    <button
      onClick={async () => {
        const r = await fetch("/api/hiring/cvs/purge-orphans", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entity_id: entityId }),
        });
        const j = await r.json().catch(() => ({}));
        setMsg(j.ok ? `${j.removed} orphan CV file${j.removed === 1 ? "" : "s"} removed` : j.error || "failed");
      }}
      className="text-[11px] text-clay underline"
    >
      {msg || "Clean up orphan CV files"}
    </button>
  );
}
