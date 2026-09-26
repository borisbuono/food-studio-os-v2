// brandScope.ts — what the top-left logo shows, and where it links, for the
// scope the user is looking at (task #61).
//
// The logo binds to the SCOPE, never to the fs_entity cookie:
//   /studio/**         → Food Studios mark, links to /studio
//   /h/<slug>/**       → that house's mark, links to /h/<slug>
//   legacy path (/office, /boh …) → the cookie-bound house (resolveScope
//                        lifts it into a house scope), links to /h/<slug>
//   nothing resolves   → the fallback entity, links to /
// A house with no pinned artwork (a new tenant) still gets its name as a
// wordmark — BrandMark used to render nothing for it.

import { E_HOLDINGS, type EntityKey } from "@/lib/entities";
import { HOUSE_SLUG_TO_ENTITY, houseNameForSlug, houseSlugForEntity } from "@/lib/houses";
import { resolveScope, type Scope } from "@/lib/scope";

export type ScopeBrand = { entity: EntityKey | null; name: string | null; href: string };

export function brandForScope(scope: Scope | null, fallback: EntityKey | null): ScopeBrand {
  if (scope?.level === "studio") return { entity: E_HOLDINGS, name: null, href: "/studio" };
  if (scope && (scope.level === "house" || scope.level === "room")) {
    return {
      entity: HOUSE_SLUG_TO_ENTITY[scope.houseSlug] ?? null,
      name: houseNameForSlug(scope.houseSlug),
      href: `/h/${scope.houseSlug}`,
    };
  }
  return { entity: fallback, name: null, href: "/" };
}

export function brandForPath(pathname: string, cookieEntity: EntityKey | null): ScopeBrand {
  return brandForScope(resolveScope(pathname, houseSlugForEntity(cookieEntity)), cookieEntity);
}

// The entity the chrome is "in" — the house in the URL, the Studio, or the
// cookie on a legacy path. Used for the switcher dot + selected row.
export function scopeEntity(scope: Scope | null, cookieEntity: EntityKey): EntityKey | null {
  if (scope?.level === "studio") return E_HOLDINGS;
  if (scope && (scope.level === "house" || scope.level === "room")) return HOUSE_SLUG_TO_ENTITY[scope.houseSlug] ?? null;
  return cookieEntity;
}

// Where picking another house in the switcher should take the user.
//   on /h/<a>/…        → /h/<b>/…   (same screen, the other house — the room
//                        landings are gone, so keep the whole tail)
//   anywhere else      → null (caller just swaps the cookie + refreshes,
//                        legacy paths are cookie-bound)
export function hrefForHouseSwitch(pathname: string, targetSlug: string): string | null {
  if (!pathname.startsWith("/h/")) return null;
  const parts = pathname.split("/").filter(Boolean); // ["h", slug, ...tail]
  const tail = parts.slice(2);
  // Dynamic ids (a recipe, an opening) belong to ONE house — drop to the verb.
  const safeTail: string[] = [];
  for (const seg of tail) { if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(seg)) break; safeTail.push(seg); }
  return `/h/${targetSlug}` + (safeTail.length ? "/" + safeTail.join("/") : "");
}
