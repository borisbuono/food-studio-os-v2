"use client";

import { useMemo, useState } from "react";
import { POST_CHANNELS, PostChannel, renderJobPost, JobOpening } from "@/lib/hiring";

type Post = {
  id: string;
  channel: string;
  channel_target: string | null;
  message_body: string | null;
  posted_at: string | null;
  external_ref: string | null;
  status: string;
  created_at: string;
};

const CHANNEL_LABEL: Record<PostChannel, string> = {
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  instagram: "Instagram",
  website: "Website",
  portal: "Portal",
  internal: "Internal email",
};

export default function OpeningEditor({
  slug,
  opening: initial,
  initialPosts,
}: {
  slug: string;
  opening: JobOpening & { status: string };
  initialPosts: Post[];
}) {
  const [opening, setOpening] = useState(initial);
  const [posts, setPosts] = useState<Post[]>(initialPosts);
  const [busy, setBusy] = useState(false);
  const [description, setDescription] = useState(initial.description || "");

  // Post-to panel state.
  const [selChannels, setSelChannels] = useState<Record<PostChannel, boolean>>({
    whatsapp: true,
    telegram: false,
    instagram: false,
    website: false,
    portal: false,
    internal: false,
  });
  const [targets, setTargets] = useState<Record<PostChannel, string>>({
    whatsapp: "",
    telegram: "",
    instagram: "",
    website: "",
    portal: "",
    internal: "",
  });
  const [customs, setCustoms] = useState<Record<PostChannel, string>>({
    whatsapp: "",
    telegram: "",
    instagram: "",
    website: "",
    portal: "",
    internal: "",
  });

  const previews = useMemo(() => {
    const out: Partial<Record<PostChannel, string>> = {};
    for (const ch of POST_CHANNELS) {
      if (!selChannels[ch]) continue;
      out[ch] = renderJobPost(opening, ch, { customMessage: customs[ch] });
    }
    return out;
  }, [opening, selChannels, customs]);

  async function saveJD() {
    setBusy(true);
    try {
      const res = await fetch(`/api/hiring/openings/${opening.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) return alert(j.error || "failed");
      setOpening((prev) => ({ ...prev, description: j.opening.description }));
    } finally {
      setBusy(false);
    }
  }

  async function updateStatus(status: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/hiring/openings/${opening.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) return alert(j.error || "failed");
      setOpening((prev) => ({ ...prev, status: j.opening.status }));
    } finally {
      setBusy(false);
    }
  }

  async function draftPosts() {
    const channels = POST_CHANNELS.filter((c) => selChannels[c]).map((c) => ({
      channel: c,
      target: targets[c] || undefined,
      custom_message: customs[c] || undefined,
    }));
    if (!channels.length) return alert("Pick at least one channel");
    setBusy(true);
    try {
      const res = await fetch(`/api/hiring/openings/${opening.id}/post`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channels }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) return alert(j.error || "failed");
      setPosts((prev) => [...(j.posts as Post[]), ...prev]);
    } finally {
      setBusy(false);
    }
  }

  async function markPosted(post_id: string) {
    const ref = window.prompt("External ref (optional — group/message id):", "") || undefined;
    setBusy(true);
    try {
      const res = await fetch(`/api/hiring/openings/${opening.id}/mark-posted`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ post_id, external_ref: ref }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) return alert(j.error || "failed");
      setPosts((prev) => prev.map((p) => (p.id === post_id ? (j.post as Post) : p)));
    } finally {
      setBusy(false);
    }
  }

  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // fallback: no-op
    }
  }

  return (
    <div className="mt-6 space-y-8">
      {/* JD editor */}
      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-clay">Job description</h2>
          <div className="flex items-center gap-1">
            <select
              value={opening.status}
              onChange={(e) => updateStatus(e.target.value)}
              disabled={busy}
              className="rounded border border-black/15 bg-white px-1.5 py-1 text-xs"
            >
              <option value="draft">draft</option>
              <option value="open">open</option>
              <option value="paused">paused</option>
              <option value="closed">closed</option>
              <option value="filled">filled</option>
            </select>
          </div>
        </div>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={10}
          className="mt-2 w-full rounded border border-black/15 px-2 py-1.5 font-mono text-[12px]"
        />
        <button
          onClick={saveJD}
          disabled={busy}
          className="mt-1 rounded border border-black/15 bg-black px-2 py-1 text-[11px] text-white disabled:opacity-40"
        >
          Save JD
        </button>
      </section>

      {/* Post-to panel */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-clay">Post to</h2>
        <p className="mt-1 text-[11px] text-clay">
          Drafts only. WhatsApp / Telegram / Instagram never auto-send from Claude — Boris pastes by
          hand, then taps <em>mark as posted</em>.
        </p>
        <div className="mt-3 space-y-3">
          {POST_CHANNELS.map((ch) => (
            <div key={ch} className="rounded border border-black/10 bg-white p-2">
              <label className="flex items-center gap-2 text-xs font-medium">
                <input
                  type="checkbox"
                  checked={selChannels[ch]}
                  onChange={(e) =>
                    setSelChannels((prev) => ({ ...prev, [ch]: e.target.checked }))
                  }
                />
                {CHANNEL_LABEL[ch]}
              </label>
              {selChannels[ch] ? (
                <div className="mt-2 space-y-1.5">
                  <input
                    placeholder="target (group name, URL, phone…)"
                    value={targets[ch]}
                    onChange={(e) => setTargets((p) => ({ ...p, [ch]: e.target.value }))}
                    className="w-full rounded border border-black/15 px-2 py-1 text-xs"
                  />
                  <textarea
                    placeholder="custom message (leave blank to use auto-rendered)"
                    value={customs[ch]}
                    onChange={(e) => setCustoms((p) => ({ ...p, [ch]: e.target.value }))}
                    rows={3}
                    className="w-full rounded border border-black/15 px-2 py-1 text-xs"
                  />
                  <div className="rounded bg-black/[0.03] p-2 text-[11px] font-mono whitespace-pre-wrap">
                    {previews[ch] || ""}
                  </div>
                </div>
              ) : null}
            </div>
          ))}
        </div>
        <button
          onClick={draftPosts}
          disabled={busy}
          className="mt-3 rounded border border-black/15 bg-black px-3 py-1.5 text-xs text-white disabled:opacity-40"
        >
          Create drafts
        </button>
      </section>

      {/* Post history */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-clay">Posts</h2>
        {posts.length ? (
          <ul className="mt-2 space-y-2">
            {posts.map((p) => (
              <li key={p.id} className="rounded border border-black/10 bg-white p-2 text-xs">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="font-medium">
                    {CHANNEL_LABEL[p.channel as PostChannel] || p.channel}
                    {p.channel_target ? <span className="text-clay"> · {p.channel_target}</span> : null}
                  </div>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${
                      p.status === "posted"
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-black/5"
                    }`}
                  >
                    {p.status}
                  </span>
                </div>
                {p.message_body ? (
                  <pre className="mt-1 whitespace-pre-wrap rounded bg-black/[0.03] p-2 font-mono text-[11px]">
{p.message_body}
                  </pre>
                ) : null}
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                  <button
                    onClick={() => copyToClipboard(p.message_body || "")}
                    className="rounded border border-black/15 px-1.5 py-0.5"
                  >
                    Copy
                  </button>
                  {p.status !== "posted" ? (
                    <button
                      onClick={() => markPosted(p.id)}
                      disabled={busy}
                      className="rounded border border-black/15 bg-black px-1.5 py-0.5 text-white"
                    >
                      Mark posted
                    </button>
                  ) : (
                    <span className="text-clay">
                      posted {p.posted_at ? new Date(p.posted_at).toLocaleString() : ""}
                      {p.external_ref ? ` · ref ${p.external_ref}` : ""}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-clay">No posts drafted yet.</p>
        )}
      </section>
    </div>
  );
}
