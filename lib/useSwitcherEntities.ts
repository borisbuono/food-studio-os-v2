"use client";
// useSwitcherEntities — the switcher's source of truth.
//
// Phase 2 (2026-08-22): the entity switcher no longer renders a hardcoded
// list. It reads `entities` from Supabase (filtered active + status != ended)
// and cross-references `team_members.default_restaurant_id` for the current
// user so a worker on Bistro Mondo doesn't see Taller in the dropdown.
//
// Boris is admin → sees every active entity. A future scoped worker with
// membership only on BM sees only BM (+ BBH if the user has any operating
// membership, since the parent holding is always in-scope for its operators).
//
// Groups returned:
//   • operating   — operating_venue rows (BM, Taller today)
//   • holding     — holding_company rows (BBH today)
//   • portfolio   — advisory_client + partner + landlord rows
//
// Downstream (DesktopSidebar + TopBar switcher) renders each group as its own
// section header. Portfolio entities do NOT yet map to an EntityKey and are
// rendered non-clickable until Phase 3.

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { EntityKey, RESTAURANT_TO_ENTITY } from "@/lib/entities";
import type { EntityType } from "@/lib/scope";

export type SwitcherEntry = {
  id: string;                   // entities.id
  name: string;                 // entities.name (display)
  entity_type: EntityType;      // scope driver
  entityKey: EntityKey | null;  // null when no mapping (portfolio types today)
};

export type SwitcherGroups = {
  operating: SwitcherEntry[];
  holding:   SwitcherEntry[];
  portfolio: SwitcherEntry[];
  loading:   boolean;
};

// Name → EntityKey mapping. entities.name is the authoritative display; this
// bridges to the EntityKey union until Phase 3 replaces the union with a
// direct entities.id lookup. Match is case-insensitive on the entity's name;
// aliases cover the "Boris Buono Holdings" vs "BBH" spelling divergence.
const NAME_TO_KEY: Record<string, EntityKey> = {
  "bistro mondo":               "bistro_mondo",
  "taller":                     "taller",
  "taller sa penya":            "taller",
  "boris buono holdings":       "holdings",
  "bbh":                        "holdings",
  "ibiza food studios":         "holdings",
  "ibiza food studio":          "holdings",
};

function mapNameToKey(name: string): EntityKey | null {
  return NAME_TO_KEY[name.trim().toLowerCase()] ?? null;
}

const EMPTY: SwitcherGroups = {
  operating: [], holding: [], portfolio: [], loading: true,
};

export function useSwitcherEntities(): SwitcherGroups {
  const [state, setState] = useState<SwitcherGroups>(EMPTY);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        // Active entities only — Phase 1 added `status` and `is_active`.
        // Read both defensively: on envs where `status` hasn't shipped yet,
        // fall back to is_active only.
        let rows: any[] | null = null;
        {
          const res = await supabaseBrowser
            .from("entities")
            .select("id,name,entity_type,is_active,status")
            .eq("is_active", true)
            .order("name");
          if (!res.error && Array.isArray(res.data)) {
            rows = res.data.filter((r: any) => (r.status ?? "active") !== "ended");
          } else {
            const res2 = await supabaseBrowser
              .from("entities")
              .select("id,name,entity_type,is_active")
              .eq("is_active", true)
              .order("name");
            rows = res2.data || [];
          }
        }

        // Membership filter — from team_members.default_restaurant_id.
        // Boris (admin) has rows for BM + Taller. Once RLS opens the table to
        // the current user by session, this returns the caller's rows only.
        let allowedRestaurantIds = new Set<string>();
        let isAdminHint = false;
        try {
          const { data: sess } = await supabaseBrowser.auth.getSession();
          const uid = sess.session?.user?.id;
          const email = sess.session?.user?.email || null;
          if (uid) {
            // profiles.role tells us admin — admins see every active entity.
            const { data: prof } = await supabaseBrowser
              .from("profiles").select("role").eq("id", uid).maybeSingle();
            const role = (prof?.role || "").toLowerCase();
            if (role.includes("admin") || role.includes("owner")) isAdminHint = true;
          }
          if (email) {
            const { data: tms } = await supabaseBrowser
              .from("team_members")
              .select("default_restaurant_id,status")
              .eq("email", email);
            for (const t of tms || []) {
              if (t.status !== "archived" && t.default_restaurant_id) {
                allowedRestaurantIds.add(t.default_restaurant_id as string);
              }
            }
          }
        } catch { /* fall through — unauthenticated preview */ }

        // Build entries. For operating_venue rows, only include when the user
        // has membership OR is admin. Holding_company always included when
        // the user has any operating membership OR is admin (they oversee the
        // parent by virtue of running any child). Portfolio always included
        // for admins (Boris); scoped workers won't see them until they have
        // an advisory/partner/landlord role explicitly.
        const anyMembership = allowedRestaurantIds.size > 0 || isAdminHint;
        const hasOp = (name: string): boolean => {
          const k = mapNameToKey(name);
          if (isAdminHint) return true;
          if (!k) return false;
          // find the restaurant_id this key maps to
          for (const [rid, ek] of Object.entries(RESTAURANT_TO_ENTITY)) {
            if (ek === k && allowedRestaurantIds.has(rid)) return true;
          }
          return false;
        };

        const operating: SwitcherEntry[] = [];
        const holding: SwitcherEntry[] = [];
        const portfolio: SwitcherEntry[] = [];

        for (const r of rows || []) {
          const et = r.entity_type as EntityType;
          const entry: SwitcherEntry = {
            id: r.id,
            name: r.name,
            entity_type: et,
            entityKey: mapNameToKey(r.name),
          };
          if (et === "operating_venue") {
            if (hasOp(r.name)) operating.push(entry);
          } else if (et === "holding_company") {
            if (isAdminHint || anyMembership) holding.push(entry);
          } else if (et === "advisory_client" || et === "partner" || et === "landlord") {
            if (isAdminHint) portfolio.push(entry);
          }
        }

        if (!cancelled) {
          setState({ operating, holding, portfolio, loading: false });
        }
      } catch {
        if (!cancelled) setState({ operating: [], holding: [], portfolio: [], loading: false });
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  return state;
}
