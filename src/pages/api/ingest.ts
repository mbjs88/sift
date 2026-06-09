// Phase 1 — Ingestion entry point (free-tier, synchronous path).
//
// Two callers hit this:
//   1. The OS share sheet (PWA share_target) — an x-www-form-urlencoded POST
//      with {title,text,url}. We redirect (303) straight back so the sheet
//      closes; the actual scrape/extract/embed runs in ctx.waitUntil().
//   2. Programmatic clients / fetch() — JSON in, JSON out.
//
// No Cloudflare Queue and no service-role key: we record a job row, kick the
// pipeline off in the background of THIS request (waitUntil keeps the Worker
// alive past the response), and return immediately. Writes happen under the
// caller's RLS via the user client. The UI polls the job row for status.

import type { APIRoute } from 'astro';
import { firstUrlIn } from '../../lib/url';
import {
  userClient, bearerFromRequest, resolveActiveAccount,
} from '../../lib/supabaseUser';
import { runIngestion } from '../../lib/ingestPipeline';

export const prerender = false;

interface ShareInput {
  url: string | null;
  text: string | null;
  title: string | null;
}

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  const input = await readShareInput(request);
  const wantsJson = expectsJson(request);

  // Android often delivers the link inside `text` rather than `url`.
  const url = input.url ?? firstUrlIn(input.text) ?? firstUrlIn(input.title);
  if (!url) {
    return wantsJson
      ? json({ error: 'no_url', message: 'No shareable URL found in request.' }, 400)
      : redirect('/?ingest=no_url');
  }

  const token = bearerFromRequest(request);
  if (!token) {
    return wantsJson
      ? json({ error: 'unauthenticated', message: 'Sign in to save to Sift.' }, 401)
      : redirect('/?ingest=signin');
  }

  const supa = userClient(env, token);
  const { data: userData, error: userErr } = await supa.auth.getUser(token);
  if (userErr || !userData?.user) {
    return wantsJson
      ? json({ error: 'unauthenticated', message: 'Session expired.' }, 401)
      : redirect('/?ingest=signin');
  }
  const userId = userData.user.id;

  const accountId = await resolveActiveAccount(supa);
  if (!accountId) {
    return wantsJson
      ? json({ error: 'no_account', message: 'No account to save into.' }, 409)
      : redirect('/?ingest=no_account');
  }

  // Record the job (created_by = caller) under RLS. This row is the status the
  // UI watches; the pipeline flips it scraping -> extracting -> done/failed.
  const { data: jobRow, error: jobErr } = await supa
    .from('ingestion_jobs')
    .insert({ account_id: accountId, url, status: 'queued', created_by: userId })
    .select('id')
    .single();
  if (jobErr || !jobRow) {
    return wantsJson
      ? json({ error: 'job_insert_failed', message: jobErr?.message ?? 'unknown' }, 500)
      : redirect('/?ingest=error');
  }

  // Hand the heavy work to the background of this request so the response — and
  // the share sheet — returns now. waitUntil keeps the Worker running until the
  // pipeline resolves. The pipeline owns all its own error handling.
  const work = runIngestion(supa, env, { jobId: jobRow.id, accountId, userId, url });
  locals.runtime.ctx.waitUntil(work);

  return wantsJson
    ? json({ jobId: jobRow.id, status: 'processing' }, 202)
    : redirect('/?ingest=processing');
};

// --- helpers ---------------------------------------------------------------

async function readShareInput(request: Request): Promise<ShareInput> {
  const ct = request.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    return { url: str(body.url), text: str(body.text), title: str(body.title) };
  }
  const form = await request.formData().catch(() => null);
  return { url: str(form?.get('url')), text: str(form?.get('text')), title: str(form?.get('title')) };
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

function expectsJson(request: Request): boolean {
  const ct = request.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) return true;
  const accept = request.headers.get('accept') ?? '';
  return accept.includes('application/json') && !accept.includes('text/html');
}

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status, headers: { 'content-type': 'application/json' },
  });
}

function redirect(location: string): Response {
  return new Response(null, { status: 303, headers: { location } });
}
