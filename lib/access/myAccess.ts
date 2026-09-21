"use client";
// myAccess.ts — one client-side fetch of /api/my-memberships per page load,
// shared by AppChrome (shell mode), the house switcher and the command
// palette. The endpoint returns the tenant-filtered entity list with the
// foh/bookings flags (lib/access/tenantScope.ts).

import type { AccessibleEntity, MembershipLite } from "@/lib/access/tenantScope";

export type MyAccess = {
  signedIn: boolean;
  isOwner: boolean;
  isMulti: boolean;
  memberships: (MembershipLite & { entity_name?: string; entity_type?: string; area?: string | null })[];
  entities: AccessibleEntity[];
};

let inflight: Promise<MyAccess | null> | null = null;

export function fetchMyAccess(): Promise<MyAccess | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (!inflight) {
    inflight = fetch("/api/my-memberships", { cache: "no-store", credentials: "include" })
      .then(async (r) => {
        if (!r.ok) throw new Error("bad status " + r.status);
        const j = await r.json();
        return {
          signedIn: !!j.signedIn,
          isOwner: !!j.isOwner,
          isMulti: !!j.isMulti,
          memberships: Array.isArray(j.memberships) ? j.memberships : [],
          entities: Array.isArray(j.entities) ? j.entities : [],
        } as MyAccess;
      })
      .catch(() => { inflight = null; return null; });
  }
  return inflight;
}
