"use client";
// Small same-tab sync for the entity/role context that the home, top bar and
// downstream pages all read from localStorage. localStorage's native "storage"
// event only fires cross-tab, so we add a custom event for same-tab updates.
export function setEntity(entity: string) { localStorage.setItem("fs_entity", entity); writeCookie(entity); ping(); }
export function setRole(role: string) { localStorage.setItem("fs_role", role); ping(); }
function ping() { window.dispatchEvent(new Event("fs:ctx")); }
export function writeCookie(entity: string) { try { document.cookie = "fs_entity=" + entity + "; path=/; max-age=31536000; samesite=lax"; } catch {} }
export function readEntityCookie(): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(/(?:^|; )fs_entity=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}
export function onCtx(fn: () => void) {
  window.addEventListener("fs:ctx", fn);
  window.addEventListener("storage", fn);
  window.addEventListener("focus", fn);
  return () => { window.removeEventListener("fs:ctx", fn); window.removeEventListener("storage", fn); window.removeEventListener("focus", fn); };
}
