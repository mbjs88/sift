// Server-side health check for the LLM key — reads GEMINI_API_KEY straight from
// the Worker's environment (cloudflare:workers), runs the two real calls the
// pipeline depends on (generate + embed), and reports whether each works.
//
// It NEVER returns the key. It only reports presence (boolean) + the outcome of
// each call, with a trimmed error string when something fails. Requires a valid
// session so it isn't an open oracle — same auth surface as /api/ingest.
//
// GET /api/diag  (Authorization: Bearer <token>, or the sb-access-token cookie)

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { userClient, bearerFromRequest } from '../../lib/supabaseUser';
import { createRouter, EMBEDDING_DIM } from '../../lib/llmRouter';

export const prerender = false;

type Check =
  | { ok: true; detail?: string }
  | { ok: false; error: string };

export const GET: APIRoute = async ({ request }) => {
  // Gate on a real session so this can't be probed anonymously.
  const token = bearerFromRequest(request);
  if (!token) return json({ error: 'unauthenticated' }, 401);
  const supa = userClient(env, token);
  const { data: userData, error: userErr } = await supa.auth.getUser(token);
  if (userErr || !userData?.user) return json({ error: 'unauthenticated' }, 401);

  const key = env.GEMINI_API_KEY;
  const report = {
    geminiKeyPresent: typeof key === 'string' && key.length > 0,
    keyLength: typeof key === 'string' ? key.length : 0, // length only — never the value
    embeddingModel: env.EMBEDDING_MODEL ?? null,
    generationModel: env.GENERATION_MODEL ?? null,
    generate: { ok: false, error: 'not_run' } as Check,
    embed: { ok: false, error: 'not_run' } as Check,
  };

  if (!report.geminiKeyPresent) {
    report.generate = { ok: false, error: 'GEMINI_API_KEY is not set on the Worker' };
    report.embed = { ok: false, error: 'GEMINI_API_KEY is not set on the Worker' };
    return json(report, 200);
  }

  const router = createRouter({
    apiKey: key,
    embeddingModel: env.EMBEDDING_MODEL,
    generationModel: env.GENERATION_MODEL,
  });

  // Tiny generate — proves the key + generation model are reachable.
  try {
    const text = await router.generate('You are a health check.', 'Reply with the single word OK.');
    report.generate = { ok: true, detail: trim(text) };
  } catch (e) {
    report.generate = { ok: false, error: trim(errMsg(e)) };
  }

  // Tiny embed — proves the key + embedding model + the 768-dim contract.
  try {
    const v = await router.embed('health check', 'query');
    report.embed = v.length === EMBEDDING_DIM
      ? { ok: true, detail: `${v.length} dims` }
      : { ok: false, error: `unexpected dims: ${v.length}` };
  } catch (e) {
    report.embed = { ok: false, error: trim(errMsg(e)) };
  }

  return json(report, 200);
};

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
const trim = (s: string) => (s.length > 240 ? s.slice(0, 240) + '…' : s);

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
