// Queue control for the UI.
//   GET    → counts by status { queued, scraping, extracting, done, failed }
//   DELETE → cancel everything still waiting (status 'queued') for the account
//
// "Clear" only removes QUEUED jobs — it never touches anything already saved or
// mid-flight. All under the caller's RLS (anon key + their JWT).

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { userClient, bearerFromRequest, resolveActiveAccount } from '../../lib/supabaseUser';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const ctx = await auth(request);
  if ('error' in ctx) return json({ error: ctx.error }, ctx.status);
  const { supa, accountId } = ctx;

  const statuses = ['queued', 'scraping', 'extracting', 'done', 'failed'] as const;
  const counts: Record<string, number> = {};
  await Promise.all(
    statuses.map(async (s) => {
      const { count } = await supa
        .from('ingestion_jobs')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', accountId)
        .eq('status', s);
      counts[s] = count ?? 0;
    }),
  );
  return json(counts, 200);
};

export const DELETE: APIRoute = async ({ request }) => {
  const ctx = await auth(request);
  if ('error' in ctx) return json({ error: ctx.error }, ctx.status);
  const { supa, accountId } = ctx;

  const { data, error } = await supa
    .from('ingestion_jobs')
    .delete()
    .eq('account_id', accountId)
    .eq('status', 'queued')
    .select('id');
  if (error) return json({ error: 'delete_failed', message: error.message }, 500);
  return json({ cleared: data?.length ?? 0 }, 200);
};

async function auth(request: Request) {
  const token = bearerFromRequest(request);
  if (!token) return { error: 'unauthenticated', status: 401 as const };
  const supa = userClient(env, token);
  const { data, error } = await supa.auth.getUser(token);
  if (error || !data?.user) return { error: 'unauthenticated', status: 401 as const };
  const accountId = await resolveActiveAccount(supa);
  if (!accountId) return { error: 'no_account', status: 409 as const };
  return { supa, accountId };
}

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
