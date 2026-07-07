import { redirect } from "next/navigation";
export const dynamic = "force-dynamic";
export default function Page({ params }: { params: { id: string } }) { redirect(`/develop/menu/${params.id}/edit`); }
