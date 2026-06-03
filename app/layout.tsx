import "./globals.css";
import type { Metadata } from "next";
import TopBar from "@/components/TopBar";
import AssistantFab from "@/components/AssistantFab";
import RouteGuard from "@/components/RouteGuard";
import { serverEntity } from "@/lib/serverVenue";
import { ENTITY_ACCENT } from "@/lib/entities";

export const metadata: Metadata = {
  title: "Food Studios",
  description: "The chef-built operating system.",
};

// Render with the right accent on FIRST PAINT (no flicker waiting for client hydration).
export default function RootLayout({ children }: { children: React.ReactNode }) {
  const entity = serverEntity();
  const accent = ENTITY_ACCENT[entity];
  return (
    <html lang="en" style={{ ["--accent" as any]: accent } as any}>
      <body>
        <TopBar />
        <RouteGuard>{children}</RouteGuard>
        <AssistantFab />
      </body>
    </html>
  );
}
