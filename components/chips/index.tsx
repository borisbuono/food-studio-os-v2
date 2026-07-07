// Architecture v2 — cross-pillar object links.
// Guest / Recipe / Invoice / Supplier / Person are ONE object viewed from
// different angles. Every mention anywhere in the OS is tappable to a
// unified detail. These chips are the surface layer — no schema changes.
import Link from "next/link";

const base = "underline decoration-black/20 decoration-1 underline-offset-2 hover:decoration-black/60 transition-colors";

type ChipProps = {
  id?: string | null;
  name: string | null | undefined;
  fallback?: string;
  className?: string;
};

// The guest — bookings, reviews, sales_events, CRM.
// Grow patches add /grow/relationships/[id]; before they land the link falls
// back to /grow (the list). Never hard-fails.
export function GuestChip({ id, name, fallback = "Guest", className = "" }: ChipProps) {
  const display = name || fallback;
  if (!id) return <span className={className}>{display}</span>;
  return (
    <Link href={`/grow/relationships/${id}`} className={`${base} ${className}`}>
      {display}
    </Link>
  );
}

// The supplier / provider — invoices, orders, bank_movements, purchases.
export function SupplierChip({ id, name, fallback = "Supplier", className = "" }: ChipProps) {
  const display = name || fallback;
  if (!id) return <span className={className}>{display}</span>;
  return (
    <Link href={`/administrate/suppliers/${id}`} className={`${base} ${className}`}>
      {display}
    </Link>
  );
}

// The recipe — menu, cook mode, calculation, POS category.
// Menu items live at /menu/[id] today; recipes are folded into that surface
// pending the develop-collapse follow-up.
export function RecipeChip({ id, name, fallback = "Recipe", className = "" }: ChipProps) {
  const display = name || fallback;
  if (!id) return <span className={className}>{display}</span>;
  return (
    <Link href={`/menu/${id}`} className={`${base} ${className}`}>
      {display}
    </Link>
  );
}

// The team member — schedule, payroll, Academy, performance.
export function PersonChip({ id, name, fallback = "Team member", className = "" }: ChipProps) {
  const display = name || fallback;
  if (!id) return <span className={className}>{display}</span>;
  return (
    <Link href={`/administrate/team/${id}`} className={`${base} ${className}`}>
      {display}
    </Link>
  );
}

// The invoice — inbox, reconciliation, asiento, supplier profile.
// No dedicated /administrate/finance/scans/[id] yet — link surfaces the scan
// list scrolled to the item.
export function InvoiceChip({ id, name, fallback = "Invoice", className = "" }: ChipProps) {
  const display = name || fallback;
  if (!id) return <span className={className}>{display}</span>;
  return (
    <Link href={`/administrate/finance/scans?id=${id}`} className={`${base} ${className}`}>
      {display}
    </Link>
  );
}
