/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />

interface SiftEnv {
  ASSETS: Fetcher;
  // vars
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  LLM_PROVIDER: string;
  EMBEDDING_MODEL: string;
  GENERATION_MODEL: string;
  // secret (wrangler secret put) — embeddings + synthesis + extraction
  GEMINI_API_KEY: string;
}

// Runtime exposes both env (bindings) and ctx (waitUntil for background
// ingestion). Provided by @astrojs/cloudflare.
type Runtime = import('@astrojs/cloudflare').Runtime<SiftEnv>;
declare namespace App {
  interface Locals extends Runtime {}
}
