"use client";

// PassScreen — the wall screen at the pass (Chef v3 Phase 2 S5).
//
// Full viewport, paper on ink, large type: headings font-serif ≥ 48 px,
// numbers ≥ 72 px, readable from 3 m. Sets body[data-chef-mode="pass"] so
// ChefRoot lays the control out phone-style at wall scale (globals.css)
// and enables headset PTT. The bottom 96 px belong to Chef (the --chef-dock
// reserve, padded by body[data-chef="on"]) — nothing is rendered there.
//
// The tiles are display only: tapping them does nothing, Chef's control
// does the talking. The only link is the tiny "← house" top-left.

import { useEffect, useState } from "react";
import Link from "next/link";
import { t } from "@/lib/i18n";
import { useHeadsetPTT } from "@/lib/chef/headset";
import type { ChefNow } from "@/app/api/chef/now/route";

type Props = { house: string; entityId: string; entityName: string; tz: string };

function clock(tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  }
}

export default function PassScreen({ house, entityId, entityName, tz }: Props) {
  const [now, setNow] = useState<ChefNow | null>(null);
  const [time, setTime] = useState<string>(() => clock(tz));
  const [stale, setStale] = useState(false);

  // Pass mode for the whole page: Chef reads data-chef-mode, the shell
  // reads data-shell. Both set on mount, removed on unmount.
  useEffect(() => {
    const prevShell = document.body.getAttribute("data-shell");
    document.body.setAttribute("data-chef-mode", "pass");
    document.body.setAttribute("data-shell", "pass");
    return () => {
      document.body.removeAttribute("data-chef-mode");
      if (prevShell) document.body.setAttribute("data-shell", prevShell);
      else document.body.removeAttribute("data-shell");
    };
  }, []);

  // Clock: every 30 s in the venue tz.
  useEffect(() => {
    const iv = setInterval(() => setTime(clock(tz)), 30_000);
    setTime(clock(tz));
    return () => clearInterval(iv);
  }, [tz]);

  // The "now" strip: every 60 s, and again when the tab comes back.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch("/api/chef/now?entity=" + encodeURIComponent(entityId), { cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        const j = (await r.json()) as ChefNow;
        if (!cancelled) { setNow(j); setStale(false); }
      } catch {
        if (!cancelled) setStale(true);
      }
    };
    load();
    const iv = setInterval(load, 60_000);
    const onVis = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { cancelled = true; clearInterval(iv); document.removeEventListener("visibilitychange", onVis); };
  }, [entityId]);

  // Only the `supported` flag is used here — the toggle itself is wired in
  // ChefRoot (useHeadsetPTT(passMode && visible, onTap)). enabled=false so
  // this call registers no handlers of its own.
  const { supported } = useHeadsetPTT(false, () => {});

  const num = (n: number | undefined) => (now ? String(n ?? 0) : "–");
  const next = now?.next_booking ?? null;

  return (
    <main
      className="flex min-h-[calc(100dvh-var(--chef-dock))] flex-col bg-paper text-ink select-none"
      style={{ padding: "clamp(16px, 3vw, 40px)" }}
    >
      {/* Top: house + clock */}
      <header className="flex items-start justify-between gap-6">
        <div>
          <Link href={"/h/" + house} className="font-mono text-[13px] uppercase tracking-wide text-clay">
            ← house
          </Link>
          <h1 className="mt-2 font-serif leading-none" style={{ fontSize: "clamp(48px, 6vw, 88px)" }}>{entityName}</h1>
        </div>
        <div className="text-right">
          <p className="font-mono text-[13px] uppercase tracking-wide text-clay">{stale ? t("chef.offline") : t("chef.pass_now")}</p>
          <p className="font-serif tabular-nums leading-none" style={{ fontSize: "clamp(72px, 9vw, 128px)" }}>{time}</p>
        </div>
      </header>

      {/* Middle: the now strip */}
      <section className="my-auto grid grid-cols-2 gap-4 py-8 lg:grid-cols-4" aria-live="polite">
        <Tile label={t("chef.pass_covers")} value={num(now?.covers)} sub={now ? now.bookings + " ×" : ""} />
        <Tile
          label={t("chef.pass_next")}
          value={next ? next.time : now ? "—" : "–"}
          sub={next ? [next.party ? next.party + " ×" : "", next.name].filter(Boolean).join(" · ") : ""}
        />
        <Tile label={t("chef.pass_prep")} value={num(now?.prep_open)} sub={now ? "/ " + now.prep_total : ""} />
        <Tile label={t("chef.pass_inbox")} value={num(now?.inbox_waiting)} sub="" />
      </section>

      {/* Footer: one line above the Chef reserve */}
      <footer className="min-h-[28px] text-center">
        {supported ? (
          <p className="font-sans text-[20px] text-clay">{t("chef.pass_headset")}</p>
        ) : null}
      </footer>
    </main>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="flex flex-col justify-between rounded-3xl border border-line bg-paper-deep px-6 py-5" aria-label={label + " " + value}>
      <p className="font-mono text-[16px] uppercase tracking-wide text-ink-soft">{label}</p>
      <p className="mt-2 font-serif tabular-nums leading-none" style={{ fontSize: "clamp(72px, 8vw, 120px)" }}>{value}</p>
      <p className="mt-2 min-h-[32px] truncate font-sans text-[24px] text-ink-soft">{sub}</p>
    </div>
  );
}
