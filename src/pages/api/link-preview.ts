// Quick metadata peek for a link, so the user can confirm "yes, that's the page
// I mean" BEFORE we spend AI on it. Fetches the page and pulls og:title / title,
// site name, and og:image. Cheap, timed out, no AI. Auth-gated so it isn't an
// open fetch proxy.
//
// GET /api/link-preview?url=…  →  { title, site, image, kind }

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { userClient, bearerFromRequest } from '../../lib/supabaseUser';
import { classifyUrl, canonicalUrl } from '../../lib/url';

export const prerender = false;

const TIMEOUT_MS = 10_000;

export const GET: APIRoute = async ({ request, url }) => {
  const token = bearerFromRequest(request);
  if (!token) return json({ error: 'unauthenticated' }, 401);
  const supa = userClient(env, token);
  const { data, error } = await supa.auth.getUser(token);
  if (error || !data?.user) return json({ error: 'unauthenticated' }, 401);

  const target = url.searchParams.get('url')?.trim() ?? '';
  if (!/^https?:\/\//i.test(target)) return json({ error: 'bad_url' }, 400);

  const canonical = canonicalUrl(target);
  const kind = classifyUrl(canonical);
  const host = safeHost(canonical);

  const html = await fetchText(canonical);
  if (!html) {
    // Couldn't fetch (timeout/block) — still let the user proceed with host only.
    return json({ title: host, site: host, image: null, kind, canonical, partial: true }, 200);
  }

  const title =
    meta(html, 'og:title') || meta(html, 'twitter:title') ||
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || host;
  const site = meta(html, 'og:site_name') || host;
  const image = meta(html, 'og:image') || meta(html, 'twitter:image') || null;

  return json({
    title: clean(title).slice(0, 160),
    site: clean(site).slice(0, 80),
    image: image ? absolutize(image, canonical) : null,
    kind, canonical,
  }, 200);
};

function meta(html: string, prop: string): string | null {
  // property="og:title" content="…"  OR  name="…" content="…", either order.
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${prop.replace(':', ':')}["'][^>]*content=["']([^"']+)["']`,
    'i',
  );
  const re2 = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${prop}["']`,
    'i',
  );
  return html.match(re)?.[1]?.trim() ?? html.match(re2)?.[1]?.trim() ?? null;
}

function clean(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}
function absolutize(src: string, base: string): string {
  try { return new URL(src, base).toString(); } catch { return src; }
}
function safeHost(u: string): string {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; }
}

async function fetchText(url: string): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    // Only need the <head>; cap the read so huge pages don't cost us.
    const text = await res.text();
    return text.slice(0, 60_000);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
