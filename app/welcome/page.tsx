"use client";
import FabHidden from "@/components/FabHidden";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { getMyProfile, MyProfile } from "@/lib/profile";
import { ROLES } from "@/lib/roles";
import { t, Lang } from "@/lib/i18n";

// First-run tour: confirm who you are → house rules → 60-second tour → first task.
// Bilingual: lang comes from the fs_lang cookie, falling back to the language the
// manager picked on the invite (team_members.language) — so a Spanish invitee
// lands in Spanish without touching anything.
export default function Welcome() {
  const router = useRouter();
  const [p, setP] = useState<MyProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [lang, setLangState] = useState<Lang>("en");

  // tr = translate with {var} interpolation, bound to local lang state
  function tr(key: string, vars?: Record<string, string | number>) {
    let s = t(key, lang);
    if (vars) for (const k of Object.keys(vars)) s = s.replace("{" + k + "}", String(vars[k]));
    return s;
  }

  function applyLang(l: Lang) {
    document.cookie = "fs_lang=" + l + "; path=/; max-age=" + 60 * 60 * 24 * 365;
    setLangState(l);
  }

  useEffect(() => {
    getMyProfile().then(async (prof) => {
      if (!prof) { router.replace("/login"); return; }
      // Team onboarding finalize — if the user got here via /team/join, a
      // session-stashed invitation token is waiting to be consumed.
      try {
        const stashKey = Object.keys(sessionStorage).find((k) => k.startsWith("fs_join_"));
        if (stashKey) {
          const token = stashKey.slice("fs_join_".length);
          const payload = JSON.parse(sessionStorage.getItem(stashKey) || "{}");
          await fetch("/api/team/join/finalize", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ token, payload }),
          }).catch(() => {});
          try { sessionStorage.removeItem(stashKey); } catch {}
        }
      } catch {}
      setP(prof); setName(prof.name || "");
      // Idempotent: anyone who already finished the first run should not be made
      // to repeat the tour (stale /welcome link, manual nav, re-login). Send them
      // straight to their first task instead. (auth/callback only guards new users.)
      try {
        const { data: fr } = await supabaseBrowser.from("profiles").select("first_run_done_at").eq("id", prof.id).maybeSingle();
        if (fr?.first_run_done_at) { router.replace(prof.world === "office" ? "/" : "/execute/pass"); return; }
      } catch {}
      // language: cookie wins; otherwise inherit the invite's language
      const m = document.cookie.match(/(?:^|;\s*)fs_lang=(en|es)/);
      if (m) setLangState(m[1] as Lang);
      else if (prof.email) {
        try {
          const { data } = await supabaseBrowser.from("team_members").select("language").eq("email", prof.email).maybeSingle();
          if (data?.language === "es" || data?.language === "en") applyLang(data.language as Lang);
        } catch {}
      }
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function patchProfile(fields: Record<string, any>) {
    if (!p) return;
    // Columns land with the 20260611 migration — never block the tour on a missing column
    try { await supabaseBrowser.from("profiles").update(fields).eq("id", p.id); } catch {}
  }

  if (loading || !p)
    return <main className="mx-auto max-w-xl lg:max-w-4xl px-6 py-12"><FabHidden /><p className="font-serif text-2xl text-ink">{t("welcome.loading", lang)}</p></main>;

  const world = ROLES[p.world];
  const firstTask = p.world === "office"
    ? { href: "/", label: tr("welcome.task.brief") }
    : { href: "/execute/pass", label: tr("welcome.task.clockin") };

  const steps = [tr("welcome.step.you"), tr("welcome.step.rules"), tr("welcome.step.os")];

  return (
    <main className="mx-auto max-w-xl lg:max-w-4xl px-6 py-12">
      <div className="flex items-baseline justify-between">
        <p className="font-sans text-xs font-medium" style={{ color: "var(--accent)" }}>{tr("welcome.eyebrow", { i: step + 1, n: steps.length })}</p>
        <button onClick={() => applyLang(lang === "es" ? "en" : "es")} className="font-mono text-[11px] uppercase tracking-wide text-ink-soft">
          {lang === "es" ? "ES · en" : "EN · es"}
        </button>
      </div>
      <div className="mt-3 flex items-center gap-2">
        {steps.map((_, k) => <span key={k} className={"h-1.5 rounded-full transition-all " + (k === step ? "w-8" : "w-1.5 bg-black/20")} style={k === step ? { background: "var(--accent)" } : undefined} />)}
      </div>

      {step === 0 ? (
        <>
          <h1 className="mt-6 font-serif text-4xl text-ink">{tr("welcome.you.title")}</h1>
          <p className="mt-3 font-serif text-[17px] leading-relaxed text-ink-soft">{tr("welcome.you.body")}</p>
          <label className="mt-6 block">
            <span className="font-mono text-[11px] uppercase tracking-wide text-clay">{tr("welcome.you.name")}</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-xl border border-black/15 bg-transparent px-4 py-3 font-sans text-[15px] text-ink" />
          </label>
          <p className="mt-4 font-sans text-[14px] text-ink-soft">{tr("welcome.you.role")}: <span className="text-ink">{p.dbRole}</span> · {tr("welcome.you.world")}: <span className="text-ink">{world.label}</span></p>
          <button
            onClick={async () => { setBusy(true); if (name.trim() && name.trim() !== p.name) await patchProfile({ name: name.trim() }); setBusy(false); setStep(1); }}
            disabled={busy}
            className="mt-8 rounded-xl px-6 py-3 font-sans text-[14px] font-medium text-[#F7F7F4] disabled:opacity-50" style={{ background: "var(--accent)" }}>
            {tr("welcome.you.cta")}
          </button>
        </>
      ) : null}

      {step === 1 ? (
        <>
          <h1 className="mt-6 font-serif text-4xl text-ink">{tr("welcome.rules.title")}</h1>
          <div className="mt-4 space-y-3 font-serif text-[16px] leading-relaxed text-ink-soft">
            <p>{tr("welcome.rules.p1")}</p>
            <p>{tr("welcome.rules.p2")}</p>
            <p>{tr("welcome.rules.p3")}</p>
          </div>
          <button
            onClick={async () => { setBusy(true); await patchProfile({ gdpr_accepted_at: new Date().toISOString() }); setBusy(false); setStep(2); }}
            disabled={busy}
            className="mt-8 rounded-xl px-6 py-3 font-sans text-[14px] font-medium text-[#F7F7F4] disabled:opacity-50" style={{ background: "var(--accent)" }}>
            {tr("welcome.rules.cta")}
          </button>
        </>
      ) : null}

      {step === 2 ? (
        <>
          <h1 className="mt-6 font-serif text-4xl text-ink">{tr("welcome.tour.title")}</h1>
          <p className="mt-3 font-serif text-[17px] leading-relaxed text-ink-soft">{tr("welcome.tour.body", { world: world.label, n: world.points.length })}</p>
          <div className="mt-6 divide-y divide-line border-y border-line">
            {world.points.map((pt) => (
              <div key={pt.href} className="py-4">
                <p className="font-serif text-[19px] text-ink">{pt.label}</p>
                <p className="mt-0.5 font-sans text-[13px] text-ink-soft">{pt.blurb}</p>
              </div>
            ))}
          </div>
          <button
            onClick={async () => { setBusy(true); await patchProfile({ first_run_done_at: new Date().toISOString() }); setBusy(false); router.replace(firstTask.href); }}
            disabled={busy}
            className="mt-8 rounded-xl px-6 py-3 font-sans text-[14px] font-medium text-[#F7F7F4] disabled:opacity-50" style={{ background: "var(--accent)" }}>
            {busy ? "…" : tr("welcome.finish", { task: firstTask.label })}
          </button>
          <p className="mt-4"><button onClick={async () => { setBusy(true); await patchProfile({ first_run_done_at: new Date().toISOString() }); router.replace("/"); }} disabled={busy} className="font-sans text-[13px] text-ink-soft underline-offset-2 hover:underline disabled:opacity-50">{tr("welcome.skip")}</button></p>
        </>
      ) : null}
    </main>
  );
}
