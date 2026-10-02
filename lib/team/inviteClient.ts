"use client";
// inviteClient.ts — THE one invite flow for the app's two invite surfaces
// (components/merged/team/Invite.tsx = Team › Invite tab, and
// components/InviteTeammate.tsx = the "+ Add to team" card on the Team tab).
//
// Before 2026-10-02 both forms inserted a bare team_members row from the
// browser: RLS refused it (no operator_entity_id) and, even when it saved, no
// memberships row was ever created, so the invitee signed in to no house
// (TO_BORIS_cook_preflight_2026-10-02 §1a/1b). The path that works is
// POST /api/team/invite → pending_invites (+ a roster row) → the invitee opens
// /invite/accept?token= → accept_pending_invite() → memberships row → /h/<slug>.
// Both forms call inviteTeammate() below and show the accept_url it returns.

import { fetchMyAccess } from "@/lib/access/myAccess";
import { isOperating } from "@/lib/access/tenantScope";
import type { Lang } from "@/lib/i18n";

// The three roles Boris invites with. Keys are the API's InviteRole values;
// cook → kitchen, foh → dining room, manager → office (lib/memberships.ts).
export const SHEET_ROLES = ["cook", "foh", "manager"] as const;
export type SheetRole = (typeof SHEET_ROLES)[number];

export const SHEET_ROLE_LABEL: Record<SheetRole, Record<Lang, string>> = {
  cook:    { en: "Cook",           es: "Cocina",    nl: "Kok" },
  foh:     { en: "Front of house", es: "Sala",      nl: "Bediening" },
  manager: { en: "Manager",        es: "Encargado", nl: "Manager" },
};

export type InviteArgs = {
  entity_id: string;
  name: string;
  email: string;
  phone?: string | null;
  role: SheetRole;
  language: "es" | "en";
  // S3 (2026-10-02): the roster row this invite is FOR — binds the real login to
  // an existing teammate (seeded name+bm@… rows) instead of creating a second person.
  person_id?: string | null;
};

export type InviteResult =
  | { ok: true; accept_url: string; emailed: boolean; roster: boolean }
  | { ok: false; error: string; status: number };

export async function inviteTeammate(a: InviteArgs): Promise<InviteResult> {
  const res = await fetch("/api/team/invite", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      entity_id: a.entity_id,
      name: a.name.trim(),
      email: a.email.trim().toLowerCase(),
      phone: (a.phone || "").trim() || null,
      role: a.role,
      language: a.language,
      person_id: a.person_id || null,
    }),
  });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok || !j?.ok) return { ok: false, error: String(j?.error || res.statusText || "failed"), status: res.status };
  return { ok: true, accept_url: String(j.accept_url || ""), emailed: !!j.emailed, roster: !!j.roster };
}

// The houses the signed-in manager may invite into (operating venues only).
export async function invitableHouses(): Promise<{ id: string; name: string; slug: string | null }[]> {
  const my = await fetchMyAccess();
  if (!my) return [];
  return my.entities
    .filter((e) => isOperating(e.entity_type) && e.status === "active")
    .map((e) => ({ id: e.id, name: e.name, slug: e.slug }));
}

// The message the manager forwards by WhatsApp / mail — in the INVITEE's language.
export function inviteMessage(name: string, email: string, acceptUrl: string, lang: "es" | "en", houseName?: string): string {
  const first = name.trim().split(/\s+/)[0] || "";
  const house = houseName ? ` (${houseName})` : "";
  return lang === "es"
    ? `Hola ${first}! Te invitamos al Food Studio OS${house}. Abre este enlace y entra con este email (${email}): ${acceptUrl}`
    : `Hi ${first}! You're invited to the Food Studio OS${house}. Open this link and sign in with this email (${email}): ${acceptUrl}`;
}
