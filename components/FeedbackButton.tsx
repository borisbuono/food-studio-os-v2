"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { getMyProfile, MyProfile } from "@/lib/profile";
import { ENTITY_TO_RESTAURANT, EntityKey } from "@/lib/entities";

const KINDS: { k: string; label: string }[] = [
  { k: "love", label: "Love it" }, { k: "idea", label: "Idea" }, { k: "bug", label: "Bug" }, { k: "confusing", label: "Confusing" },
];

// "Note this screen" — drops a tagged note (route + venue + who) into the feedback log.
// Bottom-LEFT so it never fights the Ask FAB (bottom-right). Signed-in only.
export default function FeedbackButton() {
  const pathname = usePathname();
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("idea");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => { getMyProfile().then(setProfile); }, []);
  // don't show on the diner CSAT or auth screens
  const hide = !profile || pathname?.startsWith("/login") || pathname?.startsWith("/auth") || pathname === "/feedback";
  if (hide) return null;

  const send = async () => {
    if (!body.trim() || !profile) return;
    setBusy(true);
    const ent = (!profile.isAdmin ? profile.entity : ((localStorage.getItem("fs_entity") as EntityKey) || "utopia")) || "utopia";
    const rid = profile.restaurantId || ENTITY_TO_RESTAURANT[ent as EntityKey] || ENTITY_TO_RESTAURANT.utopia!;
    try {
      await supabaseBrowser.from("feedback").insert({
        restaurant_id: rid, route: pathname || "", author_id: profile.id, author_name: profile.name,
        author_role: profile.dbRole, kind, body: body.trim(),
      });
      setSent(true); setBody("");
      setTimeout(() => { setSent(false); setOpen(false); }, 1400);
    } catch {}
    setBusy(false);
  };

  return (
    <>
      <button onClick={() => setOpen((o) => !o)} aria-label="Note this screen"
        className="fixed bottom-5 left-5 z-50 rounded-full border border-black/15 bg-card px-3 py-2 font-mono text-[10px] uppercase tracking-wide text-ink-soft shadow-lg shadow-black/15 transition hover:border-ink/40">
        {open ? "Close" : "Note"}
      </button>
      {open ? (
        <div className="fixed bottom-20 left-5 z-50 w-[min(90vw,320px)] rounded-2xl border border-black/10 bg-card p-4 shadow-2xl shadow-black/25">
          {sent ? (
            <p className="font-serif text-[16px] text-ink">Noted — thanks. It’s on the board.</p>
          ) : (
            <>
              <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Note on <span className="text-ink">{pathname}</span></p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {KINDS.map((x) => (
                  <button key={x.k} onClick={() => setKind(x.k)} className={"rounded-full px-2.5 py-1 font-sans text-[12px] transition " + (kind === x.k ? "text-[#FBF8F2]" : "border border-black/15 text-ink-soft")} style={kind === x.k ? { background: "var(--accent)" } : undefined}>{x.label}</button>
                ))}
              </div>
              <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="What works, what doesn’t, what you’d change on this screen…" className="mt-2 h-24 w-full rounded-xl border border-black/15 bg-paper p-3 font-serif text-[15px] text-ink outline-none focus:border-ember" />
              <button onClick={send} disabled={busy || !body.trim()} className="mt-2 w-full rounded-xl px-4 py-2.5 font-sans text-[13px] font-medium text-[#FCEFE7] disabled:opacity-50" style={{ background: "var(--accent)" }}>{busy ? "Sending…" : "Add to the board"}</button>
            </>
          )}
        </div>
      ) : null}
    </>
  );
}
