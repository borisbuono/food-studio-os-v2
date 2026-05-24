"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabase";

export default function EightySixToggle({ id, initial }: { id: string; initial: boolean }) {
  const [on, setOn] = useState(!!initial);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(false);

  const toggle = async () => {
    const next = !on;
    setOn(next); setSaving(true); setErr(false);
    const { error } = await supabase.from("menu_items").update({ is_eighty_six: next }).eq("id", id);
    if (error) { setOn(!next); setErr(true); }
    setSaving(false);
  };

  return (
    <div className="mt-6">
      <button
        onClick={toggle}
        disabled={saving}
        className={"w-full rounded-xl px-6 py-4 text-center font-sans text-[15px] font-medium transition disabled:opacity-60 " +
          (on ? "bg-ochre text-[#FBF1E2]" : "border border-black/15 text-ink-soft hover:border-ember/40")}
      >
        {saving ? "Saving…" : on ? "86’d — tap to put back on the menu" : "Mark 86 — out of stock"}
      </button>
      {err ? <p className="mt-2 font-mono text-[11px] text-ember">Saving needs sign-in — this is a preview of the action.</p> : null}
    </div>
  );
}
