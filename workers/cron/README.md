# Sift nightly drainer (`sift-cron`)

A second, tiny Cloudflare Worker whose only job is to process the ingestion
queue overnight, so a big import (e.g. a whole recipe blog) finishes on its own
without the app being open.

## How it works

- The app queues recipes (`status = 'queued'` in `ingestion_jobs`) when you use
  **Import a whole site**. No AI runs at that point.
- This worker wakes on a cron (default **03:00 UTC daily**), claims up to
  `PER_RUN` queued jobs, and runs the full pipeline on each: scrape → extract
  recipe/technique/wisdom → embed → save.
- It's the **only** place a Supabase **service-role key** is used. It runs with
  no logged-in user, so it can't use a normal user token; the service role lets
  it write the queued rows (each already tagged with its `account_id` and
  `created_by`). The app Worker still has no service-role key.

## One-time setup

You need the Cloudflare CLI (already installed in the app — run these from this
folder with `npx wrangler …`).

1. **Get your Supabase service-role key**
   Supabase dashboard → your project → *Project Settings* → *API* →
   *Project API keys* → copy the **`service_role`** secret. (This is secret —
   treat it like a password.)

2. **Deploy the worker** (from `sift-app/workers/cron`):
   ```bash
   npx wrangler login          # once, opens the browser
   npx wrangler deploy
   ```
   This publishes `sift-cron` and registers the nightly cron trigger.

3. **Set the three secrets** (you'll be prompted to paste each value):
   ```bash
   npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY   # the service_role key from step 1
   npx wrangler secret put GEMINI_API_KEY              # same key the app uses
   npx wrangler secret put CRON_TRIGGER_KEY            # any random string you invent
   ```
   Secrets are stored encrypted by Cloudflare. They are **never** committed and
   never appear in code.

## Test it right now (don't wait for 3am)

After deploying, open this in your browser (replace `YOURKEY` with the
`CRON_TRIGGER_KEY` you chose):

```
https://sift-cron.<your-workers-subdomain>.workers.dev/run?key=YOURKEY
```

It runs one drain immediately and returns JSON like:

```json
{ "claimed": 30, "done": 29, "failed": 1, "remaining": 92 }
```

- `claimed` — jobs picked up this run
- `done` / `failed` — how they finished
- `remaining` — queued jobs still waiting (cleared over subsequent nights)

Without the correct `key` the endpoint returns `403`, so it isn't open to the
public.

## Tuning

- **Throughput:** raise `PER_RUN` in `wrangler.toml` (then re-`deploy`) once you
  know your Gemini free-tier headroom. 30/night clears ~150 recipes in 5 nights.
- **Time:** change the `crons` line in `wrangler.toml` (it's in **UTC**). e.g.
  `"0 16 * * *"` ≈ 3am AEST.
- **Pause:** delete the worker (`npx wrangler delete`) or remove the `[triggers]`
  block and redeploy. The open-app drainer still works either way.

## Security notes

- The service-role key bypasses Row-Level Security by design — that's why it
  lives **only** here, behind a worker with no public mutation surface (the
  `/run` endpoint is gated by `CRON_TRIGGER_KEY`).
- Never copy this key into the app, `.env`, `wrangler.toml`, or git.
