import { redirect } from "next/navigation";
// Legacy alias — the real engineering surface lives at /develop/menu/engineering.
// Old page was hardcoded to Utopia trial UUID (removed 2026-08-20 audit fix).
export default function Page() { redirect("/develop/menu/engineering"); }
