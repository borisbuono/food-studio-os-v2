# Food Studios — v2 (clean foundation)

Next.js (App Router) + TypeScript + Tailwind + Supabase. The chef-built restaurant OS, rebuilt on industry-standard rails, reading the real Supabase schema (no hardcoded data).

## Why this exists
The live app (`/index.html` at the repo root) is a single ~14k-line file with hardcoded data. The **database is already solid** — this rebuilds the front-end properly against it, screen by screen (strangler migration). The live app stays untouched until this reaches parity on the wedge, then the domain is cut over.

## Run locally
```
cd foodstudio-next
npm install
cp .env.example .env.local   # fill in the Supabase anon key
npm run dev
```

## Deploy (staging)
Import this folder as a **separate** Vercel project:
- Root Directory: `foodstudio-next`
- Framework preset: Next.js (auto-detected)
- Env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## Build order (wedge first)
1. Menu spine (dish → recipe → cost → story → pitch → training)  ← started
2. Role-worlds nav (Office / FOH / BOH) + auth
3. Daily loop (clock-in → today's priorities → MEP → cook → clean)

<!-- staging build trigger: framework=nextjs, supabase env set in Vercel (food-studio-os-xjsz) 2026-05-23T13:26:06Z -->

<!-- build trigger 2: root=foodstudio-next, include-outside disabled 2026-05-23T13:31:53Z -->
