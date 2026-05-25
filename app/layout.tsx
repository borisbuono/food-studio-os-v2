import "./globals.css";
import type { Metadata } from "next";
import TopBar from "@/components/TopBar";
import AssistantFab from "@/components/AssistantFab";
import RouteGuard from "@/components/RouteGuard";

export const metadata: Metadata = {
  title: "Food Studios",
  description: "The chef-built operating system.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <TopBar />
        <RouteGuard>{children}</RouteGuard>
        <AssistantFab />
      </body>
    </html>
  );
}
