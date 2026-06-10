// Nightly queue drainer.
//
// Cloudflare fires scheduled() on the cron in wrangler.toml. We drain up to
// PER_RUN queued ingestion_jobs using a SERVICE-ROLE Supabase client (the only
// service-role usage in the whole project — quarantined to this worker). Each
// job already carries its account_id + created_by, so the rows it writes are
// attributed correctly even though RLS is bypassed.
//
// A guarded GET /run?key=… lets you trigger a drain by hand for testing.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { runIngestion } from '../../../src/lib/ingestPipeline';

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  GEMINI_API_KEY: string;
  EMBEDDING_MODEL: string;
  GENERATION_MODEL: string;
  PER_RUN?: string;
  CRON_TRIGGER_KEY?: string;
}

export default {
  // Cron entry — keep the worker alive until the drain settles.
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(drain(env));
  },

  // Manual trigger for testing: /run?key=<CRON_TRIGGER_KEY>. Anything else is a
  // tiny health page. Never exposes secrets.
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/run') {
      if (!env.CRON_TRIGGER_KEY || url.searchParams.get('key') !== env.CRON_TRIGGER_KEY) {
        return new Response('forbidden', { status: 403 });
      }
      const result = await drain(env);
      return json(result, 200);
    }
    return new Response('sift-cron: ok', { status: 200 });
  },
};

async function drain(env: Env): Promise<{ claimed: number; done: number; failed: number; remaining: number }> {
  const perRun = Math.max(1, Number(env.PER_RUN ?? '30') || 30);
  const supa: SupabaseClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const pipelineEnv = {
    GEMINI_API_KEY: env.GEMINI_API_KEY,
    EMBEDDING_MODEL: env.EMBEDDING_MODEL,
    GENERATION_MODEL: env.GENERATION_MODEL,
  };

  const { data: jobs } = await supa
    .from('ingestion_jobs')
    .select('id, url, account_id, created_by')
    .eq('status', 'queued')
    .not('url', 'like', 'paste:%')   // pasted-text jobs run inline; nothing to reprocess here
    .order('created_at', { ascending: true })
    .limit(perRun);

  let claimed = 0, done = 0, failed = 0;
  for (const job of jobs ?? []) {
    // Guarded claim so a concurrent run (or the open-app drainer) can't double
    // process the same job.
    const { data: got } = await supa
      .from('ingestion_jobs')
      .update({ status: 'scraping', updated_at: new Date().toISOString() })
      .eq('id', job.id)
      .eq('status', 'queued')
      .select('id')
      .maybeSingle();
    if (!got) continue;
    claimed++;

    await runIngestion(supa, pipelineEnv, {
      jobId: job.id as string,
      accountId: job.account_id as string,
      userId: job.created_by as string,
      url: job.url as string,
    });

    const { data: after } = await supa
      .from('ingestion_jobs').select('status').eq('id', job.id).maybeSingle();
    if (after?.status === 'done') done++; else failed++;
  }

  const { count: remaining } = await supa
    .from('ingestion_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'queued');

  return { claimed, done, failed, remaining: remaining ?? 0 };
}

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
