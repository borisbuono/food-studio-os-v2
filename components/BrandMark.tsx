import { EntityKey } from "@/lib/entities";

// tone = the BACKGROUND the mark sits on. dark bg → white logo; light bg → black logo.
export default function BrandMark({ entity, variant = "full", tone = "light" }: { entity: EntityKey; variant?: "full" | "mark"; tone?: "dark" | "light" }) {
  const color = tone === "dark" ? "white" : "black";
  if (entity === "holdings") {
    const src = variant === "mark" ? `/brand/ifs-mark-${color}.png` : `/brand/ifs-full-${color}.png`;
    return <img src={src} alt="Ibiza Food Studio" className={variant === "mark" ? "h-7 w-auto" : "h-16 w-auto"} />;
  }
  if (entity === "taller") {
    return <img src={`/brand/taller-${color}.png`} alt="Taller Sa Penya" className={variant === "mark" ? "h-5 w-auto" : "h-11 w-auto"} />;
  }
  if (entity === "bistro_mondo") {
    const src = variant === "mark" ? `/brand/bm-mark-${color}.png` : `/brand/bm-full-${color}.png`;
    return <img src={src} alt="Bistro Mondo" className={variant === "mark" ? "h-8 w-auto" : "h-14 w-auto"} />;
  }
  if (entity === "utopia") {
    return <span className={"font-serif italic " + (tone === "dark" ? "text-[#F2ECDE]" : "text-ochre") + (variant === "mark" ? " text-[16px]" : " text-3xl")}>Restaurant Utopia</span>;
  }
  return null;
}
