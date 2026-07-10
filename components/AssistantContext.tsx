"use client";
import { useEffect } from "react";

// Pages call this with structured context describing what's on screen.
// The Assistant FAB reads window.__fsAssistantContext on every /api/ask call
// and passes it to the server as page_context. The server includes it in the
// orchestrator's context bundle when generating.
//
// (Renamed from ChefContext in Assistant Layer Sprint 5. The legacy
// window.__fsChefContext key is still populated as a compatibility shim so
// any consumer that hasn't been swept yet keeps working.)
//
// Typed shape examples:
//   { kind: "invoices", entity: "IFL", openInvoices: [{id, supplier, amount_eur}], topId }
//   { kind: "bank_movements", entity: "IFL", unmatched: [{id, date, description, amount_eur}] }
//   { kind: "dish", id, name, costed }
//   { kind: "supplier", id, name, openOrders }
export default function AssistantContext({ context }: { context: any }) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    (window as any).__fsAssistantContext = context;
    (window as any).__fsChefContext = context; // compat — remove in Sprint 6.
    return () => {
      (window as any).__fsAssistantContext = null;
      (window as any).__fsChefContext = null;
    };
  }, [JSON.stringify(context)]);
  return null;
}
