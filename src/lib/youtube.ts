// Transcript-first YouTube ingestion.
//
// Native Gemini video understanding is slow (the model literally "watches" the
// video), flaky on the free tier, and capped at 8 video-hours/day. But cooking
// videos nearly always carry captions plus a description that already contains
// the recipe. So: pull the watch page, lift the description and caption track,
// and feed Gemini plain text — seconds instead of minutes. The pipeline falls
// back to native video only when a video has no captions and no description.

export interface YouTubeText {
  title: string;
  text: string;   // description + transcript, capped
}

const TIMEOUT_MS = 20_000;
const MAX_CHARS = 24_000; // same context budget as scrapeArticle

interface CaptionTrack { baseUrl: string; languageCode?: string; kind?: string; }

export async function fetchYouTubeText(videoUrl: string): Promise<YouTubeText> {
  const html = await get(videoUrl);

  const title =
    unescapeJson(html.match(/"title":\s*"((?:[^"\\]|\\.)*)","lengthSeconds"/)?.[1]) ||
    decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s*-\s*YouTube\s*$/i, '').trim() || '') ||
    videoUrl;

  const description = unescapeJson(html.match(/"shortDescription":\s*"((?:[^"\\]|\\.)*)"/)?.[1]) ?? '';

  let transcript = '';
  const track = pickTrack(parseCaptionTracks(html));
  if (track?.baseUrl) {
    try {
      const sep = track.baseUrl.includes('?') ? '&' : '?';
      const raw = await get(`${track.baseUrl}${sep}fmt=json3`);
      transcript = parseJson3(raw);
    } catch { /* no transcript — description may still be enough */ }
  }

  const text = [
    description && `VIDEO DESCRIPTION:\n${description}`,
    transcript && `SPOKEN TRANSCRIPT:\n${transcript}`,
  ].filter(Boolean).join('\n\n').slice(0, MAX_CHARS);

  return { title: title.slice(0, 300), text };
}

// ---------------------------------------------------------------------------

async function get(url: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'accept-language': 'en',
        // Skip the EU consent interstitial, which otherwise replaces the page.
        cookie: 'CONSENT=YES+cb; SOCS=CAI',
      },
      redirect: 'follow',
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`youtube fetch failed: ${res.status} ${res.statusText}`);
    return await res.text();
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new Error(`youtube fetch timed out after ${TIMEOUT_MS / 1000}s`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function parseCaptionTracks(html: string): CaptionTrack[] {
  const m = html.match(/"captionTracks":(\[.+?\}\])/);
  if (!m) return [];
  try {
    return JSON.parse(m[1]) as CaptionTrack[];
  } catch {
    return [];
  }
}

// Prefer hand-written English captions, then auto-generated ("asr") English,
// then whatever the video has — the model copes fine with other languages.
function pickTrack(tracks: CaptionTrack[]): CaptionTrack | null {
  if (tracks.length === 0) return null;
  const en = (t: CaptionTrack) => (t.languageCode ?? '').toLowerCase().startsWith('en');
  return (
    tracks.find((t) => en(t) && t.kind !== 'asr') ??
    tracks.find(en) ??
    tracks[0]
  );
}

// timedtext fmt=json3 → { events: [{ segs: [{ utf8 }] }] }
function parseJson3(raw: string): string {
  try {
    const json = JSON.parse(raw) as { events?: Array<{ segs?: Array<{ utf8?: string }> }> };
    return (json.events ?? [])
      .flatMap((e) => e.segs ?? [])
      .map((s) => s.utf8 ?? '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  } catch {
    return '';
  }
}

// YouTube embeds strings JSON-escaped (\n, &, \"). Round-trip through
// JSON.parse to unescape them safely.
function unescapeJson(s: string | undefined): string | undefined {
  if (s === undefined) return undefined;
  try { return JSON.parse(`"${s}"`) as string; } catch { return s; }
}

function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
}
