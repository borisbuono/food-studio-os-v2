"use client";
import { useEffect } from "react";

// Pages call this with structured context describing what's on screen.
// The FAB reads window.__fsChefContext on every /api/ask call and passes
// it to the server as page_context. Server includes it in the system prompt.
//
// Typed shape examples:
//   { kind: "invoices", entity: "IFL", openInvoices: [{id, supplier, amount_eur}], topId }
//   { kind: "bank_movements", entity: "IFL", unmatched: [{id, date, description, amount_eur}] }
//   { kind: "dish", id, name, costed }
//   { kind: "supplier", id, name, openOrders }
export default function ChefContext({ context }: { context: any }) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    (window as any).__fsChefContext = context;
    return () => { (window as any).__fsChefContext = null; };
  }, [JSON.stringify(context)]);
  return null;
}
