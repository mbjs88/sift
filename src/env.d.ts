/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />

// Astro 6: the `cloudflare:workers` module types its `env` export from the
// GLOBAL `Env` interface. Declaring it here gives `import { env } from
// 'cloudflare:workers'` full typing across the app.
declare global {
  interface Env {
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
}

// Astro 6 removed Locals.runtime. The ExecutionContext (waitUntil for
// background ingestion) is now exposed on Astro.locals.cfContext.
declare namespace App {
  interface Locals {
    cfContext: ExecutionContext;
  }
}

export {};
