// Source classification + normalisation. The consumer routes on this: YouTube
// goes to Gemini as a video; everything else is scraped to text first.

export type SourceKind = 'youtube' | 'article';

const YT_HOSTS = new Set([
  'youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'www.youtu.be',
]);

export function classifyUrl(raw: string): SourceKind {
  try {
    const host = new URL(raw).hostname.toLowerCase();
    return YT_HOSTS.has(host) ? 'youtube' : 'article';
  } catch {
    return 'article';
  }
}

// Canonical watch URL Gemini accepts. Strips playlist/timestamp noise and
// expands youtu.be short links so the same video never ingests twice.
export function normalizeYouTube(raw: string): string {
  const u = new URL(raw);
  let id = '';
  if (u.hostname.includes('youtu.be')) id = u.pathname.slice(1);
  else if (u.pathname.startsWith('/shorts/')) id = u.pathname.split('/')[2] ?? '';
  else id = u.searchParams.get('v') ?? '';
  if (!id) return raw;
  return `https://www.youtube.com/watch?v=${id}`;
}

// Android share sheets often deliver the link inside `text`, not `url`.
// Pull the first http(s) URL out of an arbitrary shared string.
export function firstUrlIn(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.match(/https?:\/\/[^\s]+/);
  return m ? m[0] : null;
}
