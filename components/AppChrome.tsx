"use client";
import { usePathname } from "next/navigation";
import DesktopSidebar from "@/components/DesktopSidebar";
import TopBar from "@/components/TopBar";

// Chrome (sidebar + topbar) that hides on public/unauth routes so /welcome
// and /login render as a marketing shell, not the entity-scoped app shell.
// Boris asked (2026-08-19): "logging in on top of Bistro Mondo... it needs
// a front page for Food Studio OS."
const PUBLIC_PREFIXES = ["/welcome", "/login", "/auth/", "/m/", "/booking-terms"];

function isPublic(path: string): boolean {
  return PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(p));
}

export default function AppChrome({ children }: { children: React.ReactNode }) {
  const path = usePathname() || "/";
  if (isPublic(path)) {
    return <>{children}</>;
  }
  return (
    <>
      <DesktopSidebar />
      <div className="lg:hidden">
        <TopBar />
      </div>
      <div className="lg:pl-60">{children}</div>
    </>
  );
}
