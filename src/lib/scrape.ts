// Minimal, dependency-free readable-text extraction for the Workers runtime.
// JSDOM/Readability don't run on workerd; this is a pragmatic strip-and-collapse.
// Good enough to feed the LLM, which does the real signal extraction. Swap for
// a hosted readability service later if article quality demands it.

export interface ScrapeResult {
  title: string;
  text: string;
}

export async function scrapeArticle(url: string): Promise<ScrapeResult> {
  const res = await fetch(url, {
    headers: { 'user-agent': 'SiftBot/0.1 (+https://sift.app)' },
    redirect: 'follow',
  });
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
