import { redirect } from "next/navigation";

// Transitional redirect. Recipe detail moved under Develop · Menu — a recipe
// is a menu item viewed from the craft angle. Kept six months so bookmarks
// and Chef FAB "open the recipe" hand-offs from earlier builds keep working.
// Remove after 2027-01-08 (feature #4 fold, Boris-agent 2026-07-08).
export const dynamic = "force-dynamic";
export default function Page({ params }: { params: { id: string } }) { redirect(`/develop/menu/${params.id}`); }
