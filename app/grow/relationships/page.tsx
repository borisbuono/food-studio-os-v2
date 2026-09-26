import Guests from "./Guests";
import NewGuest from "./NewGuest";

// /grow/relationships — guests / CRM (a Service leaf). Slim OS slice 4:
// /grow/relationships/new folded in as ?new=1 (a sheet on the list).
export const dynamic = "force-dynamic";

export default function GuestsPage({ searchParams }: { searchParams?: { new?: string } }) {
  return searchParams?.new ? <NewGuest /> : <Guests />;
}
