# Auth — how a sign-in works today, and the one open decision

Written 2026-10-02 (security hardening, slice S5). The 2026-08-16 note "auth is on a launch-day
workaround (localStorage)" is **out of date**: the rebuild it asked for (option 3, server-side
callback + chunked cookies + middleware refresh) landed between 2026-08-19 and 2026-08-23
(tasks #7, #11, #13, #69). This file is the current picture.

## The flow

```
/login ──signInWithOAuth (PKCE)──▶ Google ──▶ Supabase Auth ──▶ /auth/callback?code=…
                                                                   │  Route Handler (server)
                                                                   │  exchangeCodeForSession
                                                                   │  Set-Cookie sb-fs-auth.0 / .1 (chunked)
                                                                   │  + fs_entity, fs_lang
                                                                   ▼
                                                    302 → /studio or /h/<slug>
every request ──▶ middleware.ts withSupabaseSession() ──▶ getUser() refreshes the token when needed,
                                                        rotated cookies copied onto the response
server components / route handlers ──▶ lib/supabaseServer.ts (getAll/setAll) ──▶ RLS as the user
client components ──▶ lib/supabaseBrowser.ts (createBrowserClient) ──▶ reads the same cookies ──▶ RLS as the user
```

- Cookie: `sb-fs-auth` (chunked `.0`, `.1` by `@supabase/ssr` 0.12), `Secure`, `SameSite=Lax`, `Path=/`,
  `Domain=.foodstudio.ai` in prod (apex + www share it), host-only on previews/localhost.
  `lib/authCookies.ts` is the one place these attributes live; server, middleware and browser read it.
- The callback writes cookies **on the response object** (not `cookies().set()` — Next drops those on a
  redirect) and, since S5, through the `getAll`/`setAll` adapter, which also clears any stale chunk —
  the bare `sb-fs-auth` that shadowed the valid pair on 2026-08-20 cannot come back from this path.
- `SessionMigrator` (June 2026: copy a localStorage session into cookies) is gone (S5). Anyone with only a
  pre-June localStorage session signs in again once.
- SSR renders the signed-in user: `/h/<slug>`, `/studio`, `/me/today` all read `supabaseServer().auth.getUser()`;
  `/api/me` returns the profile from the same client. No Guest flash: the chrome is server-rendered with the user.

## The open decision — HttpOnly

The cookies are **not** HttpOnly, on purpose (`authCookieOptions.httpOnly: false`). Reason: 46 client
components query Supabase directly through `supabaseBrowser` under RLS, and `createBrowserClient` reads the
session from `document.cookie`. That is the documented Supabase + Next.js pattern.

What HttpOnly would buy: an XSS payload could not read the token. What it costs: every one of those 46
components (Chef drawer, rota board, clock kiosk, capture station, inbox …) would have to go through route
handlers instead of RLS-scoped browser queries — a multi-day refactor, not a slice.

What protects us today without HttpOnly: a strict CSP is **not** in place (follow-up), RLS limits what a stolen
token can read to that person's houses, tokens rotate (1 h access / refresh on use), and there is no
third-party script on the authenticated pages.

Boris's call: (a) leave as is and add a CSP; or (b) schedule the refactor (browser client → server actions)
as its own lane after the email and security lanes. Recommendation: (a) now, (b) when the next big UI pass
touches those components anyway.

## Verify (Boris, on the S5 preview, 3 min)

1. Safari on iPhone: open the preview, sign in with Google → lands on `/studio`, name in the chrome on first paint (no "Guest" flash).
2. Chrome desktop: same. Then `/api/me` in a tab → `{"profile":{…}}`.
3. Dev tools → Application → Cookies: `sb-fs-auth.0`, `sb-fs-auth.1`, no bare `sb-fs-auth`; `fs_entity`, `fs_lang`.
4. Console: no React #418 / #423 hydration errors on `/h/bm`, `/studio`, `/me/today`.
5. Leave the tab for >1 h, click around: still signed in (middleware refreshed).
