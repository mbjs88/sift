// Drain one job from the queue. The client calls this in a gentle loop while the
// app is open, so a big backlog (e.g. a whole imported blog) gets processed a
// little at a time without ever exceeding the free-tier daily budget.
//
// Each call: enforce the daily cap → atomically claim the oldest 'queued' job →
// run the full pipeline (awaited; one recipe fits comfortably in a request) →
// report what's left.
//
// POST  →  { processed?: id, status?, remaining, done?, capped? }
// Auth: Bearer token or sb-access-token cookie. All under the caller's RLS.

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { userClient, bearerFromRequest, resolveActiveAccount } from '../../lib/supabaseUser';
import { runIngestion } from '../../lib/ingestPipeline';

export const prerender = false;

// Conservative daily ceiling on successful ingests, so the queue can't burn
// through Gemini's free-tier allowance. Each recipe is ~1 extract + several
// embeds; 25/day keeps well under the free limits. Tune as quota allows.
const DAILY_CAP = 25;

export const POST: APIRoute = async ({ request }) => {
  const token = bearerFromRequest(request);
  if (!token) return json({ error: 'unauthenticated' }, 401);
  const supa = userClient(env, token);
  const { data: userData, error: userErr } = await supa.auth.getUser(token);
  if (userErr || !userData?.user) return json({ error: 'unauthenticated' }, 401);
  const userId = userData.user.id;

  const accountId = await resolveActiveAccount(supa);
  if (!accountId) return json({ error: 'no_account' }, 409);

  const remaining = await queuedCount(supa, accountId);

  // Daily budget — count today's successful ingests (UTC day).
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const { count: doneToday } = await supa
    .from('ingestion_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .eq('status', 'done')
    .gte('updated_at', since.toISOString());
  if ((doneToday ?? 0) >= DAILY_CAP) {
    return json({ capped: true, remaining, doneToday: doneToday ?? 0, cap: DAILY_CAP }, 200);
  }

  if (remaining === 0) return json({ done: true, remaining: 0 }, 200);

  // Find the oldest queued job, then claim it with a guarded update so two open
  // tabs can't grab the same one.
  const { data: candidate } = await supa
    .from('ingestion_jobs')
    .select('id, url')
    .eq('account_id', accountId)
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!candidate) return json({ done: true, remaining: 0 }, 200);

  const { data: claimed } = await supa
    .from('ingestion_jobs')
    .update({ status: 'scraping', updated_at: new Date().toISOString() })
    .eq('id', candidate.id)
    .eq('status', 'queued')          // lost the race if this matches nothing
    .select('id, url')
    .maybeSingle();
  if (!claimed) {
    // Someone else claimed it; let the client call again immediately.
    return json({ skipped: true, remaining: await queuedCount(supa, accountId) }, 200);
  }

  await runIngestion(supa, env, {
    jobId: claimed.id, accountId, userId, url: claimed.url as string,
  });

  // Report the terminal status the pipeline left, plus what's left to do.
  const { data: after } = await supa
    .from('ingestion_jobs').select('status').eq('id', claimed.id).maybeSingle();

  return json({
    processed: claimed.id,
    status: after?.status ?? 'unknown',
    remaining: await queuedCount(supa, accountId),
  }, 200);
};

async function queuedCount(supa: any, accountId: string): Promise<number> {
  const { count } = await supa
    .from('ingestion_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .eq('status', 'queued');
  return count ?? 0;
}

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
