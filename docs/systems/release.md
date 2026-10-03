# How a change reaches production

Written 2026-10-02 (security hardening, slice S0). Read this before pushing anything.

## The one rule

**Nobody pushes to `main`.** A change is a branch → a pull request → a Vercel preview →
Boris's tick (the merge) → production. Boris merges; builders never do.

```
branch ──push──▶ PR on GitHub ──auto──▶ Vercel preview (READY) ──Boris merges──▶ main ──auto──▶ www.foodstudio.ai
                                              │
                                    builder verifies here:
                                    tsc · verify_nav · probes · the ship note
```

## Where things run

| Layer | Production | Preview |
|---|---|---|
| App | Vercel project `food-studio-os-v2`, production branch `main`, domains `www.foodstudio.ai` / `foodstudio.ai` | Every PR gets `food-studio-os-v2-git-<branch>-borisbuonos-projects.vercel.app`. Previews require a Vercel login (SSO protection "all except custom domains") — they are not public. |
| Database | Supabase `rfdsysrdoncyoytcrzpg` (eu-west-1) | **None yet.** Supabase branching is a Pro-plan feature (~$0.013/h per branch, about €10/month). Until the org is on Pro, previews point at the production database. See "Migrations" below for how we stay safe without a staging DB. |
| Edge functions | `supabase/functions/*` deployed with the Supabase MCP / CLI | Same project; deploy only after the PR is merged. |
| Crons | `vercel.json` (2 slots, Hobby cap) + pg_cron inside Postgres + 2 GitHub Actions | pg_cron jobs are created by migrations — see below. |

## Branch and PR conventions

- Branch names: `<lane>/<topic>-<yyyy-mm>` — `sec/hardening-2026-10`, `menu/first-loop-2026-10`, `fix/<what>`.
- One PR per slice. The PR body is the short version of the ship note: what changed, how to verify, what Boris owes.
- The ship note itself goes to `06_PA/_INBOX/TO_BORIS_<lane>_<n>_shipped_<date>.md` in the project folder (not in this repo).
- Never force-push a shared branch. Never rebase `main`.
- Work from a **fresh shallow clone** (`git clone --depth 100 … /tmp/wt_<topic>`), never from the shared checkout in the project folder — parallel sessions have wiped it twice.

## Before you open the PR (the builder's gate)

Every PR must have, in the PR body:

1. `npx tsc --noEmit --skipLibCheck` — 0 errors.
2. `TMPDIR=/tmp node scripts/verify_nav.mjs` — `dead: 0`, `retired-still-present: 0`.
3. `sh scripts/test_nav_roles.sh` and `sh scripts/test_service_role_gate.sh` — all PASS (the second one is the S4 lint: an interactive route that imports a service-role client without an access check fails here).
4. Vercel preview deployment `READY` (link it).
5. If a migration touches RLS: the three-user probe (Boris / second-tenant owner / signed-in stranger) run **inside a rolled-back transaction**, with the per-table counts pasted, and the permissive-policy audit returning 0 rows:

   ```sql
   select tablename, policyname, cmd, roles from pg_policies
   where schemaname='public'
     and (roles::text like '%anon%' or coalesce(qual,'')='true' or coalesce(with_check,'')='true')
   order by 1;
   ```

## Migrations (no staging DB yet)

Until Supabase branching is on, a migration goes to the production database **before** the code that needs it merges. That is only safe if every migration is:

- **Additive and backward-compatible.** New columns are nullable or defaulted; new RPCs do not change the signature of an RPC the deployed code calls. Old code must keep working against the new schema for the hours (or days) between "migration applied" and "Boris merges".
- **Dry-run first.** Run the whole file inside `begin; … ; rollback;` on prod, with the probes, and only then `apply_migration`. The migration file goes into `supabase/migrations/<yyyymmdd>_<slice>.sql` in the same PR.
- **Reversible.** Anything that touches RLS or drops a constraint ships with `<name>_ROLLBACK.sql` next to it (the 21-09 RLS rollout is the model: policies snapshotted into `rls_audit.*` first).
- **Never** `current_person_is_owner()` in a policy; never `using (true)` for `authenticated`; always re-run the permissive-policy audit after.

Destructive changes (drop table, drop column with data, rewrite of rows) are **not** done this way. They wait for Boris's explicit tick in the ship note and are run in the same hour as the merge.

When the org moves to Pro: create a `staging` branch, point the Preview env (`NEXT_PUBLIC_SUPABASE_URL` / anon key, Preview scope only) at it, and migrations run on the branch first, prod on merge. This file gets a one-line update when that happens.

## What Boris does

1. Reads the ship note in `06_PA/_INBOX/`.
2. Opens the preview URL on his phone (signed in to Vercel) and walks the slice.
3. Merges the PR on GitHub — that is the tick. Vercel deploys `main` to production automatically.
4. If the ship note lists "owed by Boris" dashboard steps (env vars, plan tier, OAuth consents), does them before or right after the merge as the note says.

## Rollback

- App: Vercel → Deployments → previous production deployment → "Promote to Production". Under a minute.
- Database: run the slice's `_ROLLBACK.sql`. Data written between apply and rollback stays unless the file says otherwise.
- Say what you rolled back in a `TO_BORIS_rollback_<date>.md`.

## Protection of `main` (Boris, once)

Branch protection cannot be set by the builder's fine-grained PAT (the API returns 403). Boris does it once in GitHub:
Settings → Branches → Add branch ruleset (or classic rule) → target `main` → tick **Require a pull request before merging** (0 approvals is fine — the point is the PR, not the review), **Block force pushes**, **Restrict deletions**; no bypass list.

Note: on a personal GitHub Free plan, branch protection is only available on **public** repositories; a private repo needs GitHub Pro. The repo is public today. The S0 ship note lays out the trade-off.
