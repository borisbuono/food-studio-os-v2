"use client";
// useSwitcherEntities — the house switcher's source of truth.
//
// 2026-09-21 (Studio + House chrome polish): reads the tenant-filtered
// entity list from /api/my-memberships (lib/access/tenantScope.ts) instead
// of querying `entities` directly and treating any admin/owner profile role
// as "sees everything". Utopia's owner now sees Utopia; Boris sees the
// houses he holds memberships on plus his holding's portfolio.
//
// Groups returned:
//   • operating   — operating_venue rows
//   • holding     — holding_company rows
//   • portfolio   — advisory_client + partner + landlord rows (non-routable)

import { useEffect, useState } from "react";
import { isPrimaryEntity, type EntityKey } from "@/lib/entities";
import type { EntityType } from "@/lib/scope";
import { isOperating } from "@/lib/access/tenantScope";
import { fetchMyAccess } from "@/lib/access/myAccess";

export type SwitcherEntry = {
  id: string;                   // entities.id
  name: string;                 // entities.name (display)
  slug: string | null;          // entities.slug — drives /h/<slug>
  entity_type: EntityType;      // scope driver
  entityKey: EntityKey | null;  // pinned primary entity, else null
};

export type SwitcherGroups = {
  operating: SwitcherEntry[];
  holding:   SwitcherEntry[];
  portfolio: SwitcherEntry[];
  loading:   boolean;
};

const EMPTY: SwitcherGroups = { operating: [], holding: [], portfolio: [], loading: true };

export function useSwitcherEntities(): SwitcherGroups {
  const [state, setState] = useState<SwitcherGroups>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    fetchMyAccess().then((acc) => {
      if (cancelled) return;
      const operating: SwitcherEntry[] = [];
      const holding: SwitcherEntry[] = [];
      const portfolio: SwitcherEntry[] = [];
      const rows = (acc?.entities || [])
        .filter((e) => e.status !== "ended")
        .sort((a, b) => a.name.localeCompare(b.name));
      for (const e of rows) {
        const entry: SwitcherEntry = {
          id: e.id,
          name: e.name,
          slug: e.slug,
          entity_type: (isOperating(e.entity_type) ? "operating_venue" : e.entity_type) as EntityType,
          entityKey: isPrimaryEntity(e.id) ? e.id : null,
        };
        if (isOperating(e.entity_type)) {
          if (e.status === "active") operating.push(entry);
        } else if (e.entity_type === "holding_company") holding.push(entry);
        else if (["advisory_client", "partner", "landlord"].includes(e.entity_type)) portfolio.push(entry);
      }
      setState({ operating, holding, portfolio, loading: false });
    });
    return () => { cancelled = true; };
  }, []);

  return state;
}
