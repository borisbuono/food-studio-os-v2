"use client";
// Small same-tab sync for the entity/role context that the home, top bar and
// downstream pages all read from localStorage. localStorage's native "storage"
// event only fires cross-tab, so we add a custom event for same-tab updates.
export function setEntity(entity: string) { localStorage.setItem("fs_entity", entity); writeCookie(entity); ping(); }
export function setRole(role: string) { localStorage.setItem("fs_role", role); ping(); }
function ping() { window.dispatchEvent(new Event("fs:ctx")); }
// fs_entity must be ONE cookie. On prod the server (/auth/callback) writes it
// with domain=.foodstudio.ai (authCookieOptions); a host-only client write
// created a second fs_entity cookie and document.cookie returned whichever
// came first — the switcher "didn't stick" (task #27, 2026-09-21). Match the
// server's domain on prod hosts and expire any host-only twin.
function prodCookieDomain(): string | null {
  try {
    const h = window.location.hostname.toLowerCase();
    return h === "foodstudio.ai" || h.endsWith(".foodstudio.ai") ? ".foodstudio.ai" : null;
  } catch { return null; }
}
export function writeCookie(entity: string) {
  try {
    const dom = prodCookieDomain();
    if (dom) {
      document.cookie = "fs_entity=; path=/; max-age=0; samesite=lax";
      document.cookie = "fs_entity=" + entity + "; path=/; domain=" + dom + "; max-age=31536000; samesite=lax; secure";
    } else {
      document.cookie = "fs_entity=" + entity + "; path=/; max-age=31536000; samesite=lax";
    }
  } catch {}
}
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
