// Discover every blog-recipe URL on a (Shopify-style) site, so a whole creator's
// catalogue can be queued in one go. Two strategies, tried in order:
//   1. Sitemaps — /sitemap.xml → sitemap_blogs_*.xml → <loc> entries. Cheap,
//      complete, and the Worker's fetch transparently gunzips them.
//   2. Pagination fallback — crawl /blogs/<blog>?page=N and scrape article links
//      until a page yields nothing new.
//
// We only return article URLs under the SAME blog path the user pointed at
// (e.g. /blogs/recipes/<handle>), never the index, tag, or pagination URLs.

import { canonicalUrl } from './url';

const FETCH_TIMEOUT_MS = 15_000;
const MAX_URLS = 1000;        // hard ceiling — don't run away on a huge site
const MAX_PAGES = 60;         // pagination fallback safety bound

export interface Discovery {
  urls: string[];
  via: 'sitemap' | 'pagination' | 'none';
}

export async function discoverBlogRecipeUrls(rawUrl: string): Promise<Discovery> {
  const start = new URL(rawUrl);
  const origin = start.origin;
  // The blog prefix the user cares about, e.g. "/blogs/recipes".
  const blogPrefix = blogPrefixOf(start.pathname);

  const fromSitemap = await viaSitemap(origin, blogPrefix);
  if (fromSitemap.length > 0) return { urls: dedupeCap(fromSitemap), via: 'sitemap' };

  const fromPages = await viaPagination(origin, blogPrefix);
  if (fromPages.length > 0) return { urls: dedupeCap(fromPages), via: 'pagination' };

  return { urls: [], via: 'none' };
}

// ── Sitemap strategy ────────────────────────────────────────────────────────
async function viaSitemap(origin: string, blogPrefix: string): Promise<string[]> {
  const index = await fetchText(`${origin}/sitemap.xml`);
  if (!index) return [];

  const childMaps = locs(index).filter((u) => /sitemap_blogs|sitemap.*blog/i.test(u));
  // If the index already lists article URLs directly, use those too.
  const direct = locs(index).filter((u) => isArticle(u, origin, blogPrefix));
  const collected: string[] = [...direct];

  for (const map of childMaps.slice(0, 10)) {
    const xml = await fetchText(map);
    if (!xml) continue;
    for (const u of locs(xml)) {
      if (isArticle(u, origin, blogPrefix)) collected.push(u);
    }
    if (collected.length >= MAX_URLS) break;
  }
  return collected;
}

// ── Pagination fallback ─────────────────────────────────────────────────────
async function viaPagination(origin: string, blogPrefix: string): Promise<string[]> {
  const seen = new Set<string>();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const html = await fetchText(`${origin}${blogPrefix}?page=${page}`);
    if (!html) break;
    const before = seen.size;
    for (const href of hrefs(html)) {
      const abs = absolute(href, origin);
      if (abs && isArticle(abs, origin, blogPrefix)) seen.add(abs);
    }
    if (seen.size === before) break;       // page added nothing new → done
    if (seen.size >= MAX_URLS) break;
  }
  return [...seen];
}

// ── helpers ───────────────────────────────────────────────────────────────--
function blogPrefixOf(pathname: string): string {
  // "/blogs/recipes/some-post" or "/blogs/recipes" → "/blogs/recipes"
  const m = pathname.match(/^\/blogs\/[^/]+/);
  return m ? m[0] : '/blogs/recipes';
}

// An article = the blog prefix + exactly one more path segment (the handle).
function isArticle(url: string, origin: string, blogPrefix: string): boolean {
  try {
    const u = new URL(url);
    if (u.origin !== origin) return false;
    if (!u.pathname.startsWith(blogPrefix + '/')) return false;
    const rest = u.pathname.slice(blogPrefix.length + 1).replace(/\/$/, '');
    return rest.length > 0 && !rest.includes('/') && !rest.startsWith('tagged');
  } catch {
    return false;
  }
}

function locs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => decodeEntities(m[1]));
}
function hrefs(html: string): string[] {
  return [...html.matchAll(/href=["']([^"']+)["']/gi)].map((m) => decodeEntities(m[1]));
}
function absolute(href: string, origin: string): string | null {
  try { return new URL(href, origin).toString(); } catch { return null; }
}
function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&#38;/g, '&');
}

function dedupeCap(urls: string[]): string[] {
  const out = new Set<string>();
  for (const u of urls) {
    out.add(canonicalUrl(u));
    if (out.size >= MAX_URLS) break;
  }
  return [...out];
}

async function fetchText(url: string): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        accept: 'application/xml,text/html,*/*',
      },
      redirect: 'follow',
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
