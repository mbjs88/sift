// Minimal, dependency-free readable-text extraction for the Workers runtime.
// JSDOM/Readability don't run on workerd; this is a pragmatic strip-and-collapse.
// Good enough to feed the LLM, which does the real signal extraction. Swap for
// a hosted readability service later if article quality demands it.

export interface ScrapeResult {
  title: string;
  text: string;
}

const SCRAPE_TIMEOUT_MS = 20_000;

export async function scrapeArticle(url: string): Promise<ScrapeResult> {
  // Bare fetch with no timeout was the real cause of recipe links hanging in
  // "scraping" forever — a slow/blocking page never resolves. Abort it.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SCRAPE_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        // Some hosts (Shopify, Cloudflare-fronted) stall or block obvious bots,
        // so present as a normal browser to fetch the readable HTML.
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
      signal: ctrl.signal,
    });
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new Error(`scrape timed out after ${SCRAPE_TIMEOUT_MS / 1000}s`);
    }
    throw new Error(`scrape network error: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`scrape failed: ${res.status} ${res.statusText}`);
  const html = await res.text();

  const title =
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ||
    html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1]?.trim() ||
    url;

  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();

  // Cap payload so a giant page can't blow the model context / cost budget.
  const MAX = 24000;
  return { title: decodeEntities(title).slice(0, 300), text: text.slice(0, MAX) };
}

function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
}
