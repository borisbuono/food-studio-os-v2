import Link from "next/link";
import InstallInstructions from "./InstallInstructions";

export const dynamic = "force-static";
export const metadata = {
  title: "Install FS OS",
  description: "Install Food Studios OS on your phone or computer.",
};

// PWA #1 (2026-07-28) — the install page. Detects the user's platform on the
// client and shows the matching step-by-step. Renders all platforms below the
// fold too, because Boris sometimes wants to walk the team through it on
// paper — cheaper than a screen share.
export default function InstallPage() {
  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Get FS OS on your device</p>
      <h1 className="mt-2 font-serif text-[34px] leading-[1.05] text-ink">Install</h1>
      <p className="mt-3 font-serif italic text-[16px] leading-relaxed text-ink-soft">
        FS OS runs in your browser — but once you install it, voice sticks around, notifications work, and it opens fullscreen like a real app.
      </p>

      <InstallInstructions />

      <div className="mt-10 border-t border-black/10 pt-6">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Why install</p>
        <ul className="mt-3 space-y-2 font-serif text-[15px] leading-relaxed text-ink-soft">
          <li>· Mic permission persists — no re-asking every service.</li>
          <li>· Voice dictation via server-side Whisper — doesn't cut off on the first pause.</li>
          <li>· Appears in your phone's app settings, not buried inside Safari.</li>
          <li>· Opens without browser chrome — full screen, one glance to the compass.</li>
        </ul>
      </div>

      <div className="mt-10">
        <Link href="/" className="font-mono text-[10px] uppercase tracking-wide" style={{ color: "var(--accent)" }}>← home</Link>
      </div>
    </main>
  );
}
