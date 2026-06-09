// Provider-agnostic LLM access. The rest of the app imports ONLY this surface,
// so swapping Gemini for another vendor is a one-file change. Raw fetch keeps it
// workerd-safe with zero SDK weight.

import {
  EXTRACTION_SCHEMA,
  EXTRACTION_PROMPT,
  type ExtractionResult,
} from './extraction';

// 768 dims — must match the vector(768) columns and the pgvector HNSW limit.
// Single source of truth; the DB README references this number.
export const EMBEDDING_DIM = 768;

export interface RouterConfig {
  apiKey: string;
  embeddingModel: string;   // e.g. gemini-embedding-001
  generationModel: string;  // e.g. gemini-2.5-flash (must be vision-capable)
}

export type ExtractSource =
  | { kind: 'text'; text: string; sourceUrl: string }
  | { kind: 'youtube'; videoUrl: string };

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

export function createRouter(cfg: RouterConfig) {
  return {
    embed: (text: string, role: 'document' | 'query' = 'document') =>
      embed(cfg, text, role),
    extract: (src: ExtractSource) => extract(cfg, src),
    generate: (systemPrompt: string, userPrompt: string) =>
      generate(cfg, systemPrompt, userPrompt),
  };
}
export type LlmRouter = ReturnType<typeof createRouter>;

async function embed(
  cfg: RouterConfig,
  text: string,
  role: 'document' | 'query',
): Promise<number[]> {
  const url = `${BASE}/models/${cfg.embeddingModel}:embedContent?key=${cfg.apiKey}`;
  const body = {
    content: { parts: [{ text }] },
    taskType: role === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT',
    outputDimensionality: EMBEDDING_DIM,
  };
  const json = await postJson(url, body);
  const values: number[] | undefined = json?.embedding?.values;
  if (!values || values.length !== EMBEDDING_DIM) {
    throw new Error(`embed: expected ${EMBEDDING_DIM} dims, got ${values?.length}`);
  }
  return values;
}

async function extract(cfg: RouterConfig, src: ExtractSource): Promise<ExtractionResult> {
  const parts: unknown[] = [{ text: EXTRACTION_PROMPT }];
  if (src.kind === 'youtube') {
    // Native YouTube understanding: Gemini fetches + watches the video.
    parts.push({ fileData: { fileUri: src.videoUrl } });
  } else {
    parts.push({ text: `SOURCE URL: ${src.sourceUrl}\n\nCONTENT:\n${src.text}` });
  }

  const url = `${BASE}/models/${cfg.generationModel}:generateContent?key=${cfg.apiKey}`;
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: EXTRACTION_SCHEMA,
      temperature: 0.2,
    },
  };
  const json = await postJson(url, body);
  const raw = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) {
    const reason = json?.candidates?.[0]?.finishReason ?? 'unknown';
    throw new Error(`extract: empty response (finishReason=${reason})`);
  }
  const parsed = JSON.parse(raw) as ExtractionResult;
  return {
    recipe: parsed.recipe ?? null,
    techniques: parsed.techniques ?? [],
    wisdom: parsed.wisdom ?? [],
  };
}

// Plain Markdown completion for RAG synthesis (Phase 3). No responseSchema —
// we want prose, not JSON. The caller assembles the retrieved nodes into the
// userPrompt; this just turns them into a cohesive guide.
async function generate(
  cfg: RouterConfig,
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const url = `${BASE}/models/${cfg.generationModel}:generateContent?key=${cfg.apiKey}`;
  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    generationConfig: { temperature: 0.4 },
  };
  const json = await postJson(url, body);
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    const reason = json?.candidates?.[0]?.finishReason ?? 'unknown';
    throw new Error(`generate: empty response (finishReason=${reason})`);
  }
  return text as string;
}

async function postJson(url: string, body: unknown): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    // 4xx (bad/private video, bad key) is permanent; 429/5xx is retryable.
    throw new LlmError(res.status, `${res.status} ${res.statusText}: ${detail.slice(0, 400)}`);
  }
  return res.json();
}

export class LlmError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'LlmError';
  }

  // A free-tier DAILY cap (e.g. the Gemini 8h/day YouTube allowance or
  // GenerateRequestsPerDay-FreeTier) returns 429, but retrying within the same
  // 24h window is pointless — the quota won't reset. Distinguish it from an
  // ordinary per-minute 429 so the consumer can fail the job cleanly instead of
  // churning retries into the dead-letter queue. Gemini's quota detail names
  // the window: "...PerDay..." / "per day" / a daily reset hint.
  get dailyQuota(): boolean {
    return this.status === 429 && /per[\s_-]?day|daily|quota.*exceed.*day/i.test(this.message);
  }

  get retryable() {
    if (this.dailyQuota) return false;          // daily cap — won't reset on retry
    return this.status === 429 || this.status >= 500;
  }
}
