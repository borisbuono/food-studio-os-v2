import "./globals.css";
import type { Metadata, Viewport } from "next";
import TopBar from "@/components/TopBar";
import DesktopSidebar from "@/components/DesktopSidebar";
import ChefSwitch from "@/components/ChefSwitch";
import NewHireAssistantNudge from "@/components/NewHireAssistantNudge";
import SessionMigrator from "@/components/SessionMigrator";
import RouteGuard from "@/components/RouteGuard";
import KeyboardShortcuts from "@/components/KeyboardShortcuts";
import FlowStrip from "@/components/FlowStrip";
import PwaOfflineBadge from "@/components/PwaOfflineBadge";
import InstallPrompt from "@/components/InstallPrompt";
import { serverEntity } from "@/lib/serverVenue";
import { ENTITY_ACCENT } from "@/lib/entities";

// PWA #1 (2026-07-28) — manifest + Apple meta so iOS Safari treats FS OS as an
// installed web app. Once added to the Home Screen it launches in standalone
// mode, shows up in Settings → Privacy → Microphone, and keeps mic permission
// across sessions (which the tab-mode Safari refuses to do). Boris hit this
// wall on his phone: mic asked every time, cut off on first pause, no way to
// grant blanket access. This whole file is the switch.
export const metadata: Metadata = {
  title: "Food Studios",
  description: "The chef-built operating system.",
  manifest: "/manifest.webmanifest",
  applicationName: "Food Studios",
  appleWebApp: {
    capable: true,
    title: "Food Studios",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icons/icon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
  other: {
    // iOS Safari (pre-15.5) only reads the legacy names; Next's appleWebApp
    // above covers modern iOS but these keep older devices honest.
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-status-bar-style": "black-translucent",
    "apple-mobile-web-app-title": "Food Studios",
    "mobile-web-app-capable": "yes",
    "format-detection": "telephone=no",
  },
};

export const viewport: Viewport = {
  themeColor: "#5C6D3B",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover", // respects iPhone safe areas in standalone mode
};

// Render with the right accent on FIRST PAINT (no flicker waiting for client hydration).
export default function RootLayout({ children }: { children: React.ReactNode }) {
  const entity = serverEntity();
  const accent = ENTITY_ACCENT[entity];
  return (
    <html lang="en" style={{ ["--accent" as any]: accent } as any}>
      <body>
        <PwaOfflineBadge />
        {/* Desktop rail — hidden on < lg */}
        <DesktopSidebar />
        {/* Mobile / tablet top nav — hidden on lg+ */}
        <div className="lg:hidden">
          <TopBar />
        </div>
        {/* Main content — shifted right on lg+ to clear the fixed rail */}
        <div className="lg:pl-60">
          <RouteGuard>{children}</RouteGuard>
          <FlowStrip />
        </div>
        <SessionMigrator />
        <KeyboardShortcuts />
        <ChefSwitch />
        <NewHireAssistantNudge />
        <InstallPrompt />
      </body>
    </html>
  );
}
