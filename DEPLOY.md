# Sift — Deploy Runbook (free tier)

Everything here stays on free plans. Ingestion runs inline in `/api/ingest` via
`ctx.waitUntil()`, so there is no Cloudflare Queue and no paid Workers plan. There
is no service-role key anywhere — the app uses the public anon key plus each
user's JWT, and RLS does the protecting.

You need a terminal for steps 1, 5, and 6. Steps 2–4 are browser dashboards.

Prerequisites: Node 22+, a Cloudflare account, a Supabase project, a Google Cloud
project, and a Gemini API key (all free).

---

## 1. Install and build (terminal)

```bash
cd sift-app
npm install
npm run build      # first real test that the full dep tree resolves
```

If `react-force-graph-2d` pulls a peer it dislikes, that surfaces here.

---

## 2. Supabase database (browser)

Create a project, then in the SQL editor run the migrations **in order**:

```
supabase/migrations/01_extensions.sql
supabase/migrations/02_accounts.sql
supabase/migrations/03_knowledge.sql
supabase/migrations/04_match_functions.sql
supabase/migrations/05_new_user_account.sql
```

Then run `supabase/tests/tenant_isolation_test.sql` and confirm all three
assertions pass — that is the hard gate proving one tenant can't read another's
data. It rolls itself back, so it leaves no test rows behind.

From Project Settings → API, copy: **Project URL** and the **anon public** key.
You do not need the service-role key for anything.

---

## 3. Google OAuth (browser)

In Google Cloud Console → APIs & Services → Credentials, create an OAuth 2.0
Client ID (type: Web application). Set the authorized redirect URI to:

```
https://YOUR-PROJECT.supabase.co/auth/v1/callback
```

Copy the Client ID and Client Secret. In Supabase → Authentication → Providers →
Google, paste them and enable the provider.

In Supabase → Authentication → URL Configuration, set:
- **Site URL**: your deployed origin (e.g. `https://sift.<you>.workers.dev`)
- **Redirect URLs**: add both the deployed origin and `http://localhost:4321`
  (Astro's dev port) so local sign-in works.

---

## 4. Environment values

Two sides read config separately.

**Client (build-time, baked into the bundle).** Copy `.env.example` to `.env`:

```
PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

Set the same two in your Cloudflare build environment so the deployed bundle has
them. The anon key is public by design.

**Server (runtime).** Put the same URL + anon key in `wrangler.toml` under
`[vars]`. For local SSR dev, copy `.dev.vars.example` to `.dev.vars` and add the
Gemini key there.

---

## 5. Local dev (terminal, optional)

```bash
npm run dev          # http://localhost:4321
```

`.env` feeds the client; `.dev.vars` feeds the SSR endpoints via the Cloudflare
platform proxy. Sign in with Google, share or paste a recipe URL, then search.

---

## 6. Deploy (terminal)

```bash
npm run build
npx wrangler deploy                      # single Worker: app + SSR + inline ingest
npx wrangler secret put GEMINI_API_KEY   # paste when prompted
```

That's the whole deploy — one Worker, one secret. Re-run the first two lines for
each update.

---

## 7. First-run check

1. Open the deployed URL, sign in with Google. The signup trigger (migration 05)
   creates your personal brain automatically.
2. Install the PWA (browser → Add to Home Screen) so the OS share sheet shows
   "Sift".
3. Share a recipe article or a YouTube link to Sift. The share sheet closes
   immediately; the `ingestion_jobs` row moves `queued → scraping → extracting →
   done`. (Watch it in the Supabase table editor for now — a status UI is the
   next build.)
4. On `/app`, ask a synthesis question or switch to Pantry Rescue. The graph
   pulls your saved nodes together and the guide renders below.

---

## Free-tier limits to know

- **Gemini free tier** caps YouTube understanding at ~8h of video/day. A spent
  daily cap returns 429; the pipeline marks the job
  `failed` with `daily_quota_exhausted:` rather than retrying. Articles are
  unaffected.
- **`waitUntil` ingestion** runs in the background of the request. A very long
  video extraction is bound by the Worker's wall-clock budget; if a job stalls
  at `extracting`, re-share the link. Moving to Cloudflare Queues (paid, $5/mo)
  removes that ceiling and is a drop-in upgrade later.

---

## What's still open

- A status UI that polls `ingestion_jobs` (today you watch the table directly).
- Account switching for Family/enterprise brains — `resolveActiveAccount` picks
  the oldest account; the seam to honour an explicit choice is one function.
