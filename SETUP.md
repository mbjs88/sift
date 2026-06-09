# Sift — Step 1: Scaffolding & Cloudflare Configuration

This is the project skeleton: Astro 6 (SSR) + React + Tailwind v4, deployed as a
Cloudflare Worker via `@astrojs/cloudflare` v13, with a Cloudflare Queue for
asynchronous ingestion and a PWA `share_target`.

Requires **Node 22+** (Astro 6 dropped Node 18/20).

## 1. Initialise from scratch (reference)

These files were written for you. To reproduce the scaffold cleanly:

    npm create astro@latest sift-app -- --template minimal --no-install --no-git --yes
    cd sift-app
    npx astro add cloudflare react --yes
    npm install @tailwindcss/vite tailwindcss
    npm install -D @cloudflare/workers-types wrangler

Then overwrite `astro.config.mjs`, `wrangler.toml`, `tsconfig.json`, and the
`src/` + `public/` files with the versions in this folder.

## 2. Install & run

    npm install
    npm run dev        # astro dev — workerd runtime, Queue binding available locally

`platformProxy` in `astro.config.mjs` exposes the wrangler bindings to
`astro dev`, so `env.INGESTION_QUEUE` and the Supabase vars work in local dev
exactly as they do in production.

## 3. Cloudflare resources (one-time)

    npx wrangler queues create sift-ingestion
    npx wrangler queues create sift-ingestion-dlq

## 4. Secrets (never commit these)

    npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
    npx wrangler secret put GEMINI_API_KEY

The service-role key bypasses Supabase RLS and is used **only** inside the queue
consumer. The browser and SSR pages use the anon key plus the signed-in user's
JWT, so RLS is enforced on every tenant-scoped read.

## 5. Deploy

    npm run deploy     # astro build && wrangler deploy

## File map

| File | Purpose |
|------|---------|
| `astro.config.mjs` | SSR output, Cloudflare adapter, React, Tailwind v4 Vite plugin |
| `wrangler.toml` | Worker name, Queue producer + consumer, DLQ, vars, secrets contract |
| `public/manifest.json` | PWA manifest with `share_target` → POST `/api/ingest` |
| `public/sw.js` | Service worker (installability; never caches `/api/*`) |
| `src/env.d.ts` | Typed `env` bindings: `INGESTION_QUEUE`, Supabase, Gemini |
| `src/pages/index.astro` | Calm-Interface landing shell with Google sign-in affordance |
| `src/styles/global.css` | Warm linen / flour / stone theme tokens (Tailwind v4 `@theme`) |

## Share-target gotcha (carried into Step 4)

Android sends a shared link in **`text`**, not always **`url`**. `/api/ingest`
must read `url` first, then fall back to extracting the first URL from `text`.
The endpoint must finish in <500ms: validate, `env.INGESTION_QUEUE.send()`,
return 200. All scraping happens later in the consumer.

## Not yet built (later steps)

- App icons at `public/icons/icon-{192,512}.png` + maskable (placeholders referenced in manifest)
- Step 2: Supabase multi-tenant schema, pgvector tables, RLS
- Step 3: `llmRouter.ts` + queue consumer
- Step 4: `/api/ingest.ts`
- Step 5: react-force-graph + RAG synthesis UI
