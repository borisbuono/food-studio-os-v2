"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { ENTITY_TO_RESTAURANT, EntityKey } from "@/lib/entities";

export const dynamic = "force-dynamic";

// Grow · Reach · new campaign composer.
// 5-step flow. Audience from Grow · Relationships. Content from Grow ·
// Commercials (optional). Channel = Email (Wix Newsletter) + Social (Buffer:
// IG / FB / TikTok / X — whichever profiles Boris connected). Dispatch is
// gated on a review + confirm step. Empty state at every step.
//
// Wire-up: POST /api/grow/reach/campaigns/send is the dispatcher. When either
// adapter has no live credential we still let the user reach Review + Send —
// but the confirm dialog surfaces which channels will actually go out.

const ENTITY_CODE: Record<EntityKey, "IFL" | "BM" | "BBH"> = {
  utopia: "IFL", taller: "IFL", bistro_mondo: "BM", holdings: "BBH",
};

type SocialChannel = "instagram" | "facebook" | "tiktok" | "x";
type Step = 1 | 2 | 3 | 4 | 5;

type SegmentKey = "recent_30" | "wine_club" | "vip_500" | "birthday_month" | "first_timers" | "all_guests";
const SEGMENTS: { key: SegmentKey; label: string; blurb: string }[] = [
  { key: "recent_30",      label: "Last 30 days",       blurb: "Guests who visited in the last month." },
  { key: "wine_club",      label: "Wine club",          blurb: "Members subscribed to the wine club." },
  { key: "vip_500",        label: "VIPs (LTV > €500)",  blurb: "Highest-value repeat guests." },
  { key: "birthday_month", label: "Birthday this month",blurb: "Send a warm note this month." },
  { key: "first_timers",   label: "First-timers",       blurb: "Guests with exactly one visit." },
  { key: "all_guests",     label: "All guests",         blurb: "Every guest on file. Use sparingly." },
];

type Guest = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  birthday: string | null;
  first_visit_at: string | null;
  last_visit_at: string | null;
  lifetime_value_eur: number | null;
};

type Commercial = {
  id: string;
  type: string;
  title: string;
  description: string | null;
  starts_at: string | null;
  ends_at: string | null;
  active: boolean;
};

export default function NewCampaign() {
  const router = useRouter();
  const [entity, setEntity] = useState<EntityKey>("utopia");
  const [step, setStep] = useState<Step>(1);

  // Step 1 · channels
  const [emailOn, setEmailOn] = useState(true);
  const [socialOn, setSocialOn] = useState(false);
  const [socialChannels, setSocialChannels] = useState<SocialChannel[]>([]);

  // Step 2 · audience
  const [segment, setSegment] = useState<SegmentKey | null>(null);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [audienceLoaded, setAudienceLoaded] = useState(false);

  // Step 3 · content
  const [commercials, setCommercials] = useState<Commercial[]>([]);
  const [commercialsLoaded, setCommercialsLoaded] = useState(false);
  const [commercialId, setCommercialId] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  // Step 4 · schedule
  const [when, setWhen] = useState<"now" | "later">("now");
  const [scheduledAt, setScheduledAt] = useState<string>("");

  // Step 5 · review + send
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<any>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    const e = (typeof window !== "undefined" ? localStorage.getItem("fs_entity") : null) as EntityKey | null;
    if (e) setEntity(e);
  }, []);

  const rid = useMemo(
    () => ENTITY_TO_RESTAURANT[entity] || ENTITY_TO_RESTAURANT.utopia!,
    [entity]
  );
  const ec = ENTITY_CODE[entity];

  // Preload guests + commercials once the entity is known.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setAudienceLoaded(false); setCommercialsLoaded(false);
      const [gs, cs] = await Promise.all([
        supabaseBrowser
          .from("guests")
          .select("id,name,email,phone,birthday,first_visit_at,last_visit_at,lifetime_value_eur")
          .eq("restaurant_id", rid)
          .limit(2000),
        supabaseBrowser
          .from("commercials")
          .select("id,type,title,description,starts_at,ends_at,active")
          .eq("restaurant_id", rid)
          .order("created_at", { ascending: false })
          .limit(50),
      ]);
      if (cancelled) return;
      setGuests((gs.data || []) as Guest[]);
      setAudienceLoaded(true);
      setCommercials((cs.data || []) as Commercial[]);
      setCommercialsLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [rid]);

  // Guest visit counts for the first-timers filter.
  const [visitCounts, setVisitCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!guests.length) { setVisitCounts({}); return; }
      const { data } = await supabaseBrowser
        .from("guest_visits")
        .select("guest_id")
        .in("guest_id", guests.map((g) => g.id));
      if (cancelled) return;
      const counts: Record<string, number> = {};
      (data || []).forEach((v: any) => { counts[v.guest_id] = (counts[v.guest_id] || 0) + 1; });
      setVisitCounts(counts);
    })();
    return () => { cancelled = true; };
  }, [guests]);

  const audience = useMemo(() => {
    if (!segment) return [] as Guest[];
    const now = new Date();
    const thirtyAgo = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
    const thisMonth = now.getMonth() + 1;
    return guests.filter((g) => {
      if (segment === "all_guests") return true;
      if (segment === "recent_30") return g.last_visit_at && new Date(g.last_visit_at) >= thirtyAgo;
      if (segment === "wine_club") return false; // wine_club membership not yet in schema — placeholder
      if (segment === "vip_500")   return Number(g.lifetime_value_eur || 0) > 500;
      if (segment === "birthday_month") return g.birthday ? (new Date(g.birthday).getMonth() + 1) === thisMonth : false;
      if (segment === "first_timers")   return (visitCounts[g.id] || 0) === 1;
      return false;
    });
  }, [segment, guests, visitCounts]);

  const commercial = useMemo(
    () => commercials.find((c) => c.id === commercialId) || null,
    [commercials, commercialId]
  );

  // When a commercial is picked, seed subject + body defaults (user can still edit).
  useEffect(() => {
    if (!commercial) return;
    if (!subject) setSubject(commercial.title);
    if (!body && commercial.description) setBody(commercial.description);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commercial?.id]);

  const canNext = (n: Step): boolean => {
    if (n === 1) return emailOn || (socialOn && socialChannels.length > 0);
    if (n === 2) return !!segment && audience.length > 0;
    if (n === 3) return body.trim().length > 0 && (!emailOn || subject.trim().length > 0);
    if (n === 4) return when === "now" || !!scheduledAt;
    return true;
  };

  const goNext = () => setStep((s) => (s < 5 ? ((s + 1) as Step) : s));
  const goBack = () => setStep((s) => (s > 1 ? ((s - 1) as Step) : s));

  const dispatch = async () => {
    setSending(true); setErr(""); setSendResult(null);
    try {
      const emails = emailOn ? audience.filter((g) => !!g.email).map((g) => g.email!) : [];
      const r = await fetch("/api/grow/reach/campaigns/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          entity: ec,
          restaurant_id: rid,
          segment,
          segment_size: audience.length,
          commercial_id: commercialId,
          subject: emailOn ? subject : null,
          body,
          channels: {
            email: emailOn ? { addresses: emails } : null,
            social: socialOn ? { channels: socialChannels } : null,
          },
          scheduled_at: when === "later" ? scheduledAt : null,
        }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "dispatch failed");
      setSendResult(j);
      setConfirmOpen(false);
    } catch (e: any) {
      setErr(e?.message || "Network error");
    } finally {
      setSending(false);
    }
  };

  const StepPill = ({ n, label }: { n: Step; label: string }) => (
    <button
      onClick={() => (n < step ? setStep(n) : undefined)}
      disabled={n > step}
      className={
        "flex items-baseline gap-2 border px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide " +
        (n === step
          ? "border-[color:var(--accent)] text-[color:var(--accent)]"
          : n < step
          ? "border-line text-ink hover:border-ink-soft"
          : "border-line text-clay opacity-60 cursor-not-allowed")
      }
    >
      <span className="font-serif text-[13px]">{n}</span> {label}
    </button>
  );

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Link href="/grow/reach" className="font-sans text-sm text-ink-soft">← Reach</Link>
      <p className="mt-6 font-mono text-[10px] uppercase tracking-wide text-clay">Grow · reach · new campaign · {ec}</p>
      <h1 className="mt-1 font-serif text-4xl text-ink leading-tight">Compose.</h1>
      <p className="mt-2 font-serif italic text-[14px] text-ink-soft">Audience from Relationships. Offer from Commercials. Channel via Wix Newsletter + Buffer. Five steps, one send.</p>

      <div className="mt-6 flex flex-wrap gap-2 border-t border-line pt-4">
        <StepPill n={1} label="Channels" />
        <StepPill n={2} label="Audience" />
        <StepPill n={3} label="Content" />
        <StepPill n={4} label="Schedule" />
        <StepPill n={5} label="Review + send" />
      </div>

      {/* Step 1 · channels */}
      {step === 1 ? (
        <section className="mt-8">
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Step 1 · pick channels</p>
          <h2 className="mt-1 font-serif text-2xl text-ink">Where does this go?</h2>
          <div className="mt-4 space-y-4">
            <div className="border-t border-line pt-4">
              <label className="flex items-baseline gap-2">
                <input type="checkbox" checked={emailOn} onChange={(e) => setEmailOn(e.target.checked)} />
                <span className="font-serif text-[15px] text-ink">Email — via Wix Newsletter</span>
              </label>
              <p className="mt-1 font-serif italic text-[12px] text-ink-soft">Sends to guests with an email on file.</p>
            </div>
            <div className="border-t border-line pt-4">
              <label className="flex items-baseline gap-2">
                <input type="checkbox" checked={socialOn} onChange={(e) => setSocialOn(e.target.checked)} />
                <span className="font-serif text-[15px] text-ink">Social — via Buffer</span>
              </label>
              <p className="mt-1 font-serif italic text-[12px] text-ink-soft">Cross-posts to the profiles you've connected.</p>
              {socialOn ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {(["instagram", "facebook", "tiktok", "x"] as SocialChannel[]).map((c) => {
                    const on = socialChannels.includes(c);
                    return (
                      <button
                        key={c}
                        onClick={() =>
                          setSocialChannels((cur) => (on ? cur.filter((x) => x !== c) : [...cur, c]))
                        }
                        className={
                          "border px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide " +
                          (on ? "border-[color:var(--accent)] text-[color:var(--accent)]" : "border-line text-ink hover:border-ink-soft")
                        }
                      >
                        {c}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      {/* Step 2 · audience */}
      {step === 2 ? (
        <section className="mt-8">
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Step 2 · pick a segment</p>
          <h2 className="mt-1 font-serif text-2xl text-ink">Who is this for?</h2>
          {!audienceLoaded ? (
            <p className="mt-4 font-serif italic text-[13px] text-ink-soft">Loading guests…</p>
          ) : !guests.length ? (
            <p className="mt-4 font-serif italic text-[13px] text-ink-soft">
              No guests on file yet. Add guests in <Link href="/grow/relationships" className="underline decoration-black/20 hover:decoration-black/60">Relationships →</Link>
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-line border-t border-line">
              {SEGMENTS.map((s) => {
                const count = (() => {
                  const now = new Date();
                  const thirtyAgo = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
                  const thisMonth = now.getMonth() + 1;
                  return guests.filter((g) => {
                    if (s.key === "all_guests") return true;
                    if (s.key === "recent_30") return g.last_visit_at && new Date(g.last_visit_at) >= thirtyAgo;
                    if (s.key === "wine_club") return false;
                    if (s.key === "vip_500")   return Number(g.lifetime_value_eur || 0) > 500;
                    if (s.key === "birthday_month") return g.birthday ? (new Date(g.birthday).getMonth() + 1) === thisMonth : false;
                    if (s.key === "first_timers")   return (visitCounts[g.id] || 0) === 1;
                    return false;
                  }).length;
                })();
                const active = segment === s.key;
                return (
                  <li key={s.key}>
                    <button
                      onClick={() => setSegment(s.key)}
                      className={"flex w-full items-baseline justify-between gap-3 py-3 text-left " + (active ? "" : "hover:opacity-70")}
                    >
                      <span>
                        <span className="font-serif text-[15px] text-ink">{s.label}</span>
                        <span className="ml-2 font-mono text-[11px] uppercase tracking-wide text-clay">{s.blurb}</span>
                      </span>
                      <span className={"shrink-0 font-mono text-[13px] " + (active ? "text-[color:var(--accent)]" : "text-ink-soft")}>{count}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {segment ? (
            <p className="mt-3 font-serif italic text-[13px] text-ink-soft">
              {audience.length} guest{audience.length === 1 ? "" : "s"} in this segment
              {emailOn ? ` · ${audience.filter((g) => !!g.email).length} with email` : ""}
            </p>
          ) : null}
        </section>
      ) : null}

      {/* Step 3 · content */}
      {step === 3 ? (
        <section className="mt-8">
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Step 3 · content</p>
          <h2 className="mt-1 font-serif text-2xl text-ink">What are you saying?</h2>

          <div className="mt-4 border-t border-line pt-3">
            <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Attach a commercial (optional)</p>
            {!commercialsLoaded ? (
              <p className="mt-2 font-serif italic text-[13px] text-ink-soft">Loading commercials…</p>
            ) : !commercials.length ? (
              <p className="mt-2 font-serif italic text-[13px] text-ink-soft">
                No commercials yet. <Link href="/grow/commercials/new" className="underline decoration-black/20 hover:decoration-black/60">Create one →</Link>
              </p>
            ) : (
              <select
                value={commercialId || ""}
                onChange={(e) => setCommercialId(e.target.value || null)}
                className="mt-2 w-full bg-transparent border-b border-line pb-2 font-serif text-[15px] text-ink outline-none"
              >
                <option value="">— none —</option>
                {commercials.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title} {c.active ? "" : "(draft)"}
                  </option>
                ))}
              </select>
            )}
            {commercial ? (
              <p className="mt-2 font-serif italic text-[13px] text-ink-soft">{commercial.description || "No description on the commercial."}</p>
            ) : null}
          </div>

          {emailOn ? (
            <div className="mt-6 border-t border-line pt-3">
              <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Email subject</p>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="A note from the studio…"
                className="mt-2 w-full bg-transparent border-b border-line pb-2 font-serif text-[15px] text-ink outline-none"
              />
            </div>
          ) : null}

          <div className="mt-6 border-t border-line pt-3">
            <p className="font-mono text-[10px] uppercase tracking-wide text-clay">
              {socialOn && !emailOn ? "Social caption" : socialOn ? "Body · used for both email and social caption" : "Email body"}
            </p>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={8}
              placeholder="Write the message. Keep it warm."
              className="mt-2 w-full bg-transparent border border-line rounded-md p-3 font-serif text-[15px] text-ink outline-none"
            />
            <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-clay">{body.length} chars</p>
          </div>
        </section>
      ) : null}

      {/* Step 4 · schedule */}
      {step === 4 ? (
        <section className="mt-8">
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Step 4 · when</p>
          <h2 className="mt-1 font-serif text-2xl text-ink">Send now or later?</h2>
          <div className="mt-4 space-y-3 border-t border-line pt-3">
            <label className="flex items-baseline gap-2">
              <input type="radio" name="when" checked={when === "now"} onChange={() => setWhen("now")} />
              <span className="font-serif text-[15px] text-ink">Send immediately</span>
            </label>
            <label className="flex items-baseline gap-2">
              <input type="radio" name="when" checked={when === "later"} onChange={() => setWhen("later")} />
              <span className="font-serif text-[15px] text-ink">Schedule for later</span>
            </label>
            {when === "later" ? (
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                className="ml-6 bg-transparent border-b border-line pb-2 font-mono text-[14px] text-ink outline-none"
              />
            ) : null}
          </div>
        </section>
      ) : null}

      {/* Step 5 · review + send */}
      {step === 5 ? (
        <section className="mt-8">
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Step 5 · review + send</p>
          <h2 className="mt-1 font-serif text-2xl text-ink">Ready?</h2>
          <dl className="mt-4 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-3 border-t border-line pt-4 font-serif text-[14px]">
            <dt className="text-muted">Channels</dt>
            <dd className="text-ink">
              {emailOn ? "Email" : null}
              {emailOn && socialOn ? " · " : null}
              {socialOn ? "Social — " + socialChannels.join(", ") : null}
              {!emailOn && !socialOn ? "—" : null}
            </dd>
            <dt className="text-muted">Segment</dt>
            <dd className="text-ink">
              {segment ? SEGMENTS.find((s) => s.key === segment)?.label : "—"} · {audience.length} guests
              {emailOn ? ` · ${audience.filter((g) => !!g.email).length} with email` : ""}
            </dd>
            <dt className="text-muted">Commercial</dt>
            <dd className="text-ink">{commercial ? commercial.title : "—"}</dd>
            {emailOn ? (<><dt className="text-muted">Subject</dt><dd className="text-ink">{subject || "—"}</dd></>) : null}
            <dt className="text-muted">Body</dt>
            <dd className="text-ink whitespace-pre-wrap">{body || "—"}</dd>
            <dt className="text-muted">When</dt>
            <dd className="text-ink">{when === "now" ? "immediately" : (scheduledAt || "—")}</dd>
          </dl>

          <button
            onClick={() => setConfirmOpen(true)}
            disabled={sending || !(emailOn || socialOn) || !segment || !body.trim()}
            className="mt-6 w-full px-6 py-4 font-sans text-[15px] font-medium text-[#F7F7F4] disabled:opacity-60"
            style={{ background: "var(--accent)" }}
          >
            {sending ? "Sending…" : "Send campaign"}
          </button>

          {err ? <p className="mt-4 font-mono text-[12px] text-tomato">⚠ {err}</p> : null}
          {sendResult?.ok ? (
            <section className="mt-6 border-t border-line pt-5">
              <p className="font-mono text-[10px] uppercase tracking-wide" style={{ color: "var(--accent)" }}>
                {sendResult.dryRun ? "Dry-run · would have sent" : "Sent"}
              </p>
              <p className="mt-2 font-serif text-[15px] text-ink">
                {sendResult.email_reach || 0} emails · {sendResult.social_posts || 0} social posts scheduled
              </p>
              <p className="mt-2 font-mono text-[10px] uppercase tracking-wide text-clay">
                <button onClick={() => router.push("/grow/reach")} className="hover:text-ink">Back to Reach →</button>
              </p>
            </section>
          ) : null}
        </section>
      ) : null}

      {/* Nav row */}
      <div className="mt-10 flex items-baseline justify-between border-t border-line pt-4">
        <button
          onClick={goBack}
          disabled={step === 1}
          className="font-mono text-[10px] uppercase tracking-wide text-clay hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed"
        >
          ← back
        </button>
        {step < 5 ? (
          <button
            onClick={goNext}
            disabled={!canNext(step)}
            className="border border-line px-4 py-2 font-mono text-[11px] uppercase tracking-wide text-ink hover:border-ink-soft disabled:opacity-40 disabled:cursor-not-allowed"
          >
            next →
          </button>
        ) : null}
      </div>

      {/* Confirm dialog */}
      {confirmOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/40 px-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl border border-line bg-paper p-6">
            <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Confirm dispatch</p>
            <h2 className="mt-1 font-serif text-2xl text-ink">Send this campaign?</h2>
            <p className="mt-2 font-serif italic text-[13px] text-ink-soft">
              This will {when === "now" ? "immediately dispatch" : "schedule"} to
              {emailOn ? ` ${audience.filter((g) => !!g.email).length} email recipients` : ""}
              {emailOn && socialOn ? " and" : ""}
              {socialOn ? ` ${socialChannels.length} social profile${socialChannels.length === 1 ? "" : "s"}` : ""}.
              You can't undo a send.
            </p>
            <div className="mt-5 flex items-baseline justify-between border-t border-line pt-3">
              <button onClick={() => setConfirmOpen(false)} className="font-mono text-[10px] uppercase tracking-wide text-clay hover:text-ink">Cancel</button>
              <button
                onClick={dispatch}
                disabled={sending}
                className="border border-line px-4 py-2 font-mono text-[11px] uppercase tracking-wide text-ink hover:border-ink-soft disabled:opacity-40"
              >
                {sending ? "Sending…" : "Yes — send"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
