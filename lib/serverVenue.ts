import { cookies } from "next/headers";
import { EntityKey, ENTITY_TO_RESTAURANT } from "./entities";

const KEYS: EntityKey[] = ["holdings", "bistro_mondo", "taller", "utopia"];

// The venue the current view is scoped to, read from the fs_entity cookie that
// the client sets when an entity is chosen (or bound for a scoped worker).
// Server components can't see localStorage, so the cookie is the bridge.
// Defaults to Utopia (the launch venue) when unset.
export function serverEntity(): EntityKey {
  const c = cookies().get("fs_entity")?.value as EntityKey | undefined;
  return c && KEYS.includes(c) ? c : "utopia";
}
export function serverRestaurantId(): string {
  return ENTITY_TO_RESTAURANT[serverEntity()] || ENTITY_TO_RESTAURANT.utopia!;
}
