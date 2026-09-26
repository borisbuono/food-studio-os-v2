import Commercials from "./Commercials";
import NewCommercial from "./NewCommercial";

// /grow/commercials — offers and deals (a Comms leaf). Slim OS slice 4:
// /grow/commercials/new folded in as ?new=1 (a sheet on the list).
export const dynamic = "force-dynamic";

export default function CommercialsPage({ searchParams }: { searchParams?: { new?: string } }) {
  return searchParams?.new ? <NewCommercial /> : <Commercials />;
}
