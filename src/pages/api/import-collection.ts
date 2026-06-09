// Bulk import: discover every recipe on a site and queue them (deduped) for the
// drainer to process gradually. This endpoint is deliberately cheap — it only
// fetches sitemaps/listing pages and inserts 'queued' job rows. No Gemini calls
// happen here; ingestion runs later via /api/ingest-next, so we never blow the
// free-tier quota in one request.
//
// POST { url }  →  { discovered, queued, skipped, via }
// Auth: Bearer token or sb-access-token cookie. All writes under the caller RLS.

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { userClient, bearerFromRequest, resolveActiveAccount } from '../../lib/supabaseUser';
import { discoverBlogRecipeUrls } from '../../lib/discover';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const token = bearerFromRequest(request);
  if (!token) return json({ error: 'unauthenticated' }, 401);
  const supa = userClient(env, token);
  const { data: userData, error: userErr } = await supa.auth.getUser(token);
  if (userErr || !userData?.user) return json({ error: 'unauthenticated' }, 401);
  const userId = userData.user.id;

  const accountId = await resolveActiveAccount(supa);
  if (!accountId) return json({ error: 'no_account' }, 409);

  const body = (await request.json().catch(() => ({}))) as { url?: string };
  const url = typeof body.url === 'string' ? body.url.trim() : '';
  if (!url || !/^https?:\/\//i.test(url)) return json({ error: 'bad_url' }, 400);

  const { urls, via } = await discoverBlogRecipeUrls(url);
  if (urls.length === 0) {
    return json({ discovered: 0, queued: 0, skipped: 0, via, message: 'No recipes found at that URL.' }, 200);
  }

  // Skip anything already queued/processing/done for this account (failed may
  // re-queue). One read, then filter in memory.
  const { data: existingRows } = await supa
    .from('ingestion_jobs')
    .select('url, status')
    .eq('account_id', accountId)
    .neq('status', 'failed');
  const taken = new Set((existingRows ?? []).map((r) => r.url as string));

  const fresh = urls.filter((u) => !taken.has(u));
  const skipped = urls.length - fresh.length;

  // Bulk insert as 'queued' in chunks (PostgREST handles arrays fine, but keep
  // each request modest).
  let queued = 0;
  for (let i = 0; i < fresh.length; i += 100) {
    const chunk = fresh.slice(i, i + 100).map((u) => ({
      account_id: accountId, created_by: userId, url: u, status: 'queued',
    }));
    const { error, count } = await supa
      .from('ingestion_jobs')
      .insert(chunk, { count: 'exact' });
    if (!error) queued += count ?? chunk.length;
  }

  return json({ discovered: urls.length, queued, skipped, via }, 200);
};

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
