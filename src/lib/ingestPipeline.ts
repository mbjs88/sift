// Synchronous ingestion (free-tier path — no Cloudflare Queues).
//
// This is the work the consumer Worker used to do, moved inline so the app runs
// on the free plan. /api/ingest hands it off to ctx.waitUntil(), so the share
// sheet closes immediately while scrape -> extract -> embed -> store finishes in
// the background of the same request.
//
// Crucially, writes go through the caller's RLS-scoped client (created_by = the
// user), NOT a service-role key. There is no service-role key anywhere in the
// app now. The ingestion_jobs row is the status record the UI can read.

import type { SupabaseClient } from '@supabase/supabase-js';
import { createRouter, LlmError, type LlmRouter } from './llmRouter';
import { classifyUrl, normalizeYouTube } from './url';
import { scrapeArticle } from './scrape';
import { fetchYouTubeText } from './youtube';

export interface PipelineEnv {
  GEMINI_API_KEY: string;
  EMBEDDING_MODEL: string;
  GENERATION_MODEL: string;
}

export interface IngestJob {
  jobId: string;
  accountId: string;
  userId: string;     // created_by
  url: string;
  // When set, ingest this raw pasted text directly (no scrape, no source URL).
  // Used by the "paste a recipe" fallback when a page won't parse.
  rawText?: string;
}

type JobStatus = 'queued' | 'scraping' | 'extracting' | 'done' | 'failed';

export async function runIngestion(
  supa: SupabaseClient, env: PipelineEnv, job: IngestJob,
): Promise<void> {
  try {
    await setStatus(supa, job.jobId, 'scraping');

    const router = createRouter({
      apiKey: env.GEMINI_API_KEY,
      embeddingModel: env.EMBEDDING_MODEL,
      generationModel: env.GENERATION_MODEL,
    });

    // Three sources: pasted raw text (no scrape), a YouTube video, or an article
    // we scrape to text first. Raw text carries no source URL.
    const isPaste = typeof job.rawText === 'string' && job.rawText.trim().length > 0;
    const kind = isPaste ? 'text' : classifyUrl(job.url);
    const result = isPaste
      ? await router.extract({ kind: 'text', sourceUrl: '', text: job.rawText!.trim() })
      : kind === 'youtube'
        ? await extractYouTube(router, normalizeYouTube(job.url))
        : await router.extract({ kind: 'text', sourceUrl: job.url, ...(await scrapeArticle(job.url)) });

    // Pasted text has no real source URL; keep the DB clean (null instead of the
    // synthetic "paste:…" marker we use as the job key).
    const sourceUrl = isPaste ? null : job.url;

    await setStatus(supa, job.jobId, 'extracting');

    // Embed every node concurrently rather than one-at-a-time. A recipe can
    // produce a dozen nodes; sequential embeds were the bulk of the wait.
    const base = { account_id: job.accountId, created_by: job.userId, source_url: sourceUrl };

    const tasks: Array<Promise<void>> = [];
    if (result.recipe) {
      const r = result.recipe;
      tasks.push(
        router.embed(r.body, 'document').then((embedding) =>
          insert(supa, 'recipes', {
            ...base, title: r.title, body: r.body,
            embedding: vec(embedding), metadata: r.metadata,
          })),
      );
    }
    for (const t of result.techniques) {
      tasks.push(
        router.embed(t.body, 'document').then((embedding) =>
          insert(supa, 'techniques', {
            ...base, name: t.name, body: t.body,
            embedding: vec(embedding), metadata: t.metadata,
          })),
      );
    }
    for (const w of result.wisdom) {
      tasks.push(
        router.embed(w.body, 'document').then((embedding) =>
          insert(supa, 'wisdom', {
            ...base, body: w.body, embedding: vec(embedding), metadata: w.metadata,
          })),
      );
    }
    await Promise.all(tasks);

    await setStatus(supa, job.jobId, 'done');
  } catch (err) {
    // A spent free-tier daily allowance (e.g. Gemini's 8h/day YouTube cap)
    // surfaces as a 429; tag it so the UI can say "try again tomorrow" rather
    // than implying a broken link.
    const reason =
      err instanceof LlmError && err.dailyQuota
        ? `daily_quota_exhausted: ${err.message}`
        : err instanceof Error ? err.message : String(err);
    await setStatus(supa, job.jobId, 'failed', reason).catch(() => {});
  }
}

// YouTube, transcript-first: the captions + description usually carry the whole
// recipe and extract in seconds as plain text. Only when a video has neither do
// we fall back to native Gemini video understanding (slow, 8h/day free cap).
const MIN_USEFUL_CHARS = 400;

async function extractYouTube(router: LlmRouter, videoUrl: string) {
  try {
    const yt = await fetchYouTubeText(videoUrl);
    if (yt.text.length >= MIN_USEFUL_CHARS) {
      return await router.extract({
        kind: 'text',
        sourceUrl: videoUrl,
        text: `VIDEO TITLE: ${yt.title}\n\n${yt.text}`,
      });
    }
  } catch {
    // page fetch / parse failed — let Gemini watch the video instead
  }
  return router.extract({ kind: 'youtube', videoUrl });
}

// pgvector over PostgREST wants the textual literal '[1,2,3]'.
function vec(values: number[]): string {
  return `[${values.join(',')}]`;
}

async function setStatus(
  supa: SupabaseClient, jobId: string, status: JobStatus, error?: string,
): Promise<void> {
  await supa.from('ingestion_jobs')
    .update({ status, error: error ?? null, updated_at: new Date().toISOString() })
    .eq('id', jobId);
}

async function insert(
  supa: SupabaseClient, table: 'recipes' | 'techniques' | 'wisdom',
  row: Record<string, unknown>,
): Promise<void> {
  const { error } = await supa.from(table).insert(row);
  if (error) throw new Error(`insert ${table}: ${error.message}`);
}
