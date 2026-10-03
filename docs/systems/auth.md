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

## HttpOnly — decided 2026-10-03: not yet, CSP instead

The cookies are **not** HttpOnly, on purpose (`authCookieOptions.httpOnly: false`). Reason: 46 client
components query Supabase directly through `supabaseBrowser` under RLS, and `createBrowserClient` reads the
session from `document.cookie`. That is the documented Supabase + Next.js pattern.

What HttpOnly would buy: an XSS payload could not read the token. What it costs: every one of those 46
components (Chef drawer, rota board, clock kiosk, capture station, inbox …) would have to go through route
handlers instead of RLS-scoped browser queries — a multi-day refactor, not a slice.

**Boris ruled (a) on 2026-10-03: add the CSP now, do the refactor when the next big UI pass touches those
components anyway.** So the position is: the token is readable by script by design, and the CSP below is
what stops a script that reads it from doing anything with it. RLS still caps what a stolen token can see to
that person's houses, and tokens rotate (1 h access, refresh on use).

The refactor is not cancelled, it is queued. When it happens, `httpOnly: true` goes in `lib/authCookies.ts`
and this section gets rewritten.

## The CSP (S5a, 2026-10-03)

`lib/security/csp.mjs` builds it; `next.config.mjs` decides which paths get which. Two headers go out on
every response.

**Enforced.** Shaped by one fact, verified on 2026-10-03: the browser in this app only ever talks to
itself and to Supabase. Every third-party call — Anthropic, Holded, Google, Fresto, Resend, Wix, TheFork,
Apideck — is made server-side from a route handler (`grep 'fetch("https://' app components` returns
nothing). So the three ways a stolen token could leave the browser are all closed and closing them breaks
nothing:

| Directive | Value | Why |
|---|---|---|
| `connect-src` | `'self'` + the Supabase origin (https + wss) | the exfiltration route that matters |
| `form-action` | `'self'` | an injected form cannot post the session out; Google OAuth is a navigation, not a form post, so sign-in is unaffected |
| `img-src` | `'self' data: blob:` + Supabase | no third-party host to beacon to. `blob:` for capture thumbnails and the Receiving / WinePrices previews |
| `object-src` | `'none'` | plugins |
| `base-uri` | `'self'` | stops a rewritten base tag re-pointing relative URLs |
| `frame-src` | `'none'` | the app renders no iframes |
| `style-src` / `font-src` | `'self' 'unsafe-inline'` + `fonts.googleapis.com` / `fonts.gstatic.com` | Google Fonts: `@import` in `app/globals.css`, plus a `<link>` on `/apply/<house>` for the per-house brand fonts |
| `media-src` | `'self' blob:` | the Chef drawer plays `/api/chef/say` audio from an object URL |
| `script-src` | `'self' 'unsafe-inline'` (+ `'unsafe-eval'` outside production, or `next dev` blocks itself) | **the remaining gap** — see below |

**Report-Only.** The same policy with `'unsafe-inline'` removed from `script-src` and `style-src`. Nothing is
blocked by it; the violations post to `/api/csp-report`, which logs one line each to the Vercel runtime log
and stores nothing. That log is the evidence for the nonce pass: Next 14 injects its bootstrap and
flight-data scripts inline and nothing hands them a nonce yet, so enforcing `script-src 'self'` today would
white-screen the OS. When the reports show what a nonce has to cover, the middleware sets one and
`strictScripts` becomes the enforced policy — one line, with evidence instead of a guess.

Deliberately **not** a table: a public endpoint that writes rows is a free way for anyone to fill the
database, and nothing acts on an individual report. Same shape as the observation log — cheap to write,
read only at synthesis.

**`frame-ancestors 'none'` is per-path, not global.** The authenticated app, `/welcome` and `/login` get it
(framing a login page is the textbook clickjack). The guest-facing pages do not: `/m/<slug>/*`, `/book/*`,
`/apply/*`, `/leads/capture`, `/legal/*`, `/recipes/<slug>`. Those are linked from bistro-mondo.com and
ibzfoodstudio.com and **may be embedded there** — nobody has checked the Wix sites, and breaking a live
booking or job-application embed mid-season to close a theoretical hole is the wrong trade.

→ **Open, one fact needed:** what actually embeds those pages. Then `'none'` becomes `frame-ancestors` with
that list and the exception disappears. Until someone looks at the Wix sites, leaving them frameable is the
reversible choice.

The two rules have non-overlapping sources, so no path ever receives two CSP headers.
`scripts/test_csp_headers.sh` asserts that against a real build — phase 1 reads the policy out of
`next.config.mjs`, phase 2 boots the built app and checks the headers as a browser would receive them,
because a `path-to-regexp` source that looks right and matches nothing is the failure mode worth guarding.

**Also shipped in the same header block:** `X-Content-Type-Options: nosniff`, `Referrer-Policy:
strict-origin-when-cross-origin`, and a `Permissions-Policy` that keeps camera and microphone (the capture
station photographs albaranes, the Chef drawer takes voice) and switches off geolocation, payment, USB and
Bluetooth.

**HSTS is Vercel's, not ours.** Verified 2026-10-03 against the live edge: `max-age=63072000` on
www.foodstudio.ai, and `max-age=63072000; includeSubDomains; preload` on the `*.vercel.app` preview hosts.
An app-level header would be a second, *weaker* one (a year), and a browser takes the first it sees — so
setting it here would downgrade what Vercel already does. `scripts/test_csp_headers.sh` fails if the app
ever starts sending it.

→ **Open, Boris's call, in Vercel's domain settings and not in this repo:** whether www.foodstudio.ai gets
`includeSubDomains` and `preload`. It forces HTTPS on every present and future foodstudio.ai subdomain, and
preload is slow to undo. Needs a list of the subdomains first.

### Adding a third-party endpoint later

If a feature ever needs the browser to call something new, the answer is almost always **call it
server-side from a route handler** — that keeps the policy tight and the API key off the client. If it
genuinely must be a browser call, add the origin to `connect-src` in `lib/security/csp.mjs`, and expect
`scripts/test_csp_headers.sh` to fail until you have also updated the assertion that says `connect-src` is
self + Supabase only. The failing test is the point: widening it should be a decision, not a diff.

## Verify (Boris, on the S5 preview, 3 min)

1. Safari on iPhone: open the preview, sign in with Google → lands on `/studio`, name in the chrome on first paint (no "Guest" flash).
2. Chrome desktop: same. Then `/api/me` in a tab → `{"profile":{…}}`.
3. Dev tools → Application → Cookies: `sb-fs-auth.0`, `sb-fs-auth.1`, no bare `sb-fs-auth`; `fs_entity`, `fs_lang`.
4. Console: no React #418 / #423 hydration errors on `/h/bm`, `/studio`, `/me/today`.
5. Leave the tab for >1 h, click around: still signed in (middleware refreshed).
6. **CSP (added 2026-10-03).** With the console open, walk `/studio`, `/h/bm`, `/me/today`, the Chef drawer
   (make it speak), `/capture` (take one photo) and `/h/bm/comms`: no red `Refused to …` lines. Yellow
   `[Report Only]` lines are expected and are the point — they are the inline scripts the nonce pass has to
   cover. Then `/m/bistrot-mondo/proposal` and `/apply/bm` on a phone: the brand fonts still load.
