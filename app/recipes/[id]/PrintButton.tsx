"use client";
export default function PrintButton() {
  return (
    <button onClick={() => window.print()} className="no-print font-mono text-[11px] uppercase tracking-[0.2em] text-tomato hover:opacity-70">
      Print
    </button>
  );
}
