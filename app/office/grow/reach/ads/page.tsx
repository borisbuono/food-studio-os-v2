import { redirect } from "next/navigation";

// Pillar-scoped alias — the canonical route lives at /grow/reach/ads. This tiny
// stub keeps muscle-memory URLs alive under the new FOH/BOH/Office nav
// without duplicating any real logic. See lib/routing/pillar-map.ts and
// the Commit #2 comment history.
export default function Page() { redirect("/grow/reach/ads"); }
