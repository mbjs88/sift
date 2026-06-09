// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

// Astro 6 + @astrojs/cloudflare v13: the adapter runs workerd in dev,
// prerender, and production, so Queue / KV / env bindings behave identically
// across all stages. Output is 'server' (SSR/hybrid) so /api routes compile
// to the Cloudflare Worker; static pages are still prerendered where marked.
export default defineConfig({
  output: 'server',
  adapter: cloudflare({
    // Expose the local wrangler bindings (Queues, vars) to `astro dev`.
    platformProxy: { enabled: true },
  }),
  integrations: [react()],
  // Astro's default CSRF guard rejects form-encoded POSTs whose Origin doesn't
  // match the host — which is exactly the OS-initiated PWA share_target POST to
  // /api/ingest ("Cross-site POST form submissions are forbidden"). Turn it off:
  // every mutating endpoint independently requires a valid Supabase JWT (bearer
  // header for the in-app JSON path, sb-access-token cookie for the share path),
  // so origin-checking adds nothing we don't already enforce via auth + RLS.
  security: { checkOrigin: false },
  vite: {
    plugins: [tailwindcss()],
  },
});
