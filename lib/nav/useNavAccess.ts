"use client";
// useNavAccess — the one client hook behind the three nav renderers: loads
// /api/my-memberships once (lib/access/myAccess.ts caches the promise) and
// returns the PaletteAccess for the house in scope. NO_ACCESS until loaded,
// so the dock/rail start with the ungated verbs and grow — never shrink.

import { useEffect, useMemo, useState } from "react";
import { fetchMyAccess, type MyAccess } from "@/lib/access/myAccess";
import { accessForHouse } from "@/lib/nav/visible";
import type { PaletteAccess } from "@/lib/access/tenantScope";

export function useNavAccess(houseSlug: string | null, fallbackEntityId: string | null = null): { access: PaletteAccess; my: MyAccess | null } {
  const [my, setMy] = useState<MyAccess | null>(null);
  useEffect(() => {
    let live = true;
    fetchMyAccess().then((a) => { if (live) setMy(a); });
    return () => { live = false; };
  }, []);
  const access = useMemo(() => accessForHouse(my, houseSlug, fallbackEntityId), [my, houseSlug, fallbackEntityId]);
  return { access, my };
}
