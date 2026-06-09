// Add a source straight from the website — the on-screen twin of the PWA
// share_target. Paste a recipe/video URL, POST it to /api/ingest as JSON with
// the bearer token (same auth as synthesis; no form-POST, so no CSRF surface),
// then watch the ingestion_jobs row move queued -> scraping -> extracting ->
// done under the caller's RLS.
//
// Visually this is deliberately NOT the Sift search bar: a dashed "intake" card
// with an ember accent, so adding knowledge reads differently from querying it.
//
// Mounted client:only — it reads the browser session the shell already seeded.

import { useState } from 'react';
import { browserSupabase } from '../lib/authClient';

function sessionToken(): string | null {
  const m = document.cookie.match(/(?:^|;\s*)sb-access-token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

type Phase = 'idle' | 'submitting' | 'working' | 'done' | 'failed';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function AddSource() {
  const [url, setUrl] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [note, setNote] = useState<string | null>(null);

  const busy = phase === 'submitting' || phase === 'working';

  async function add() {
    const link = url.trim();
    if (!link || busy) return;
    if (!looksLikeUrl(link)) {
      setPhase('failed');
      setNote('That doesn’t look like a link.');
      return;
    }

    const token = sessionToken();
    if (!token) {
      setPhase('failed');
      setNote('Sign in to add a source.');
      return;
    }

    setPhase('submitting');
    setNote(null);
    try {
      const res = await fetch('/api/ingest', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ url: link }),
      });
      const body = (await res.json().catch(() => ({}))) as { jobId?: string; error?: string };
      if (!res.ok || !body.jobId) {
        setPhase('failed');
        setNote(messageFor(body.error));
        return;
      }
      setUrl('');
      setPhase('working');
      setNote('Added. Sift is reading it…');
      await pollJob(body.jobId);
    } catch {
      setPhase('failed');
      setNote('Something went wrong. Try again.');
    }
  }

  // Watch the job row (RLS-scoped to the caller's account) until it resolves.
  // We read `error` too, so a failed job shows the REAL reason, not a guess.
  async function pollJob(jobId: string) {
    const supa = browserSupabase();
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      await sleep(2500);
      const { data } = await supa
        .from('ingestion_jobs')
        .select('status, error')
        .eq('id', jobId)
        .single();
      const s = data?.status as string | undefined;
      if (s === 'done') {
        setPhase('done');
        setNote('Saved to your knowledge.');
        return;
      }
      if (s === 'failed') {
        setPhase('failed');
        setNote(failureMessage(data?.error as string | null | undefined));
        return;
      }
      if (s) setNote(labelFor(s));
    }
    // Still running past the watch window — it keeps going server-side.
    setPhase('done');
    setNote('Still processing — it’ll appear shortly.');
  }

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="flex flex-col gap-3 rounded-2xl border border-dashed border-[color:var(--color-ember)]/50 bg-[color:var(--color-linen)] px-4 py-4">
        <div className="flex items-center gap-2 text-sm text-[color:var(--color-ink-soft)]">
          <span
            className="grid place-items-center w-5 h-5 rounded-full text-[color:var(--color-flour)] text-base leading-none"
            style={{ background: 'var(--color-ember)' }}
            aria-hidden="true"
          >
            +
          </span>
          <span className="uppercase tracking-wide text-xs">Add a source</span>
        </div>

        <div className="flex items-center gap-2">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
            inputMode="url"
            autoComplete="off"
            placeholder="Paste a recipe or YouTube link…"
            className="flex-1 bg-transparent outline-none text-[color:var(--color-ink)] placeholder:text-[color:var(--color-ink-soft)]"
          />
          <button
            onClick={add}
            disabled={busy}
            className="rounded-xl px-4 py-1.5 text-sm text-[color:var(--color-flour)] transition-transform active:scale-95 disabled:opacity-40"
            style={{ background: 'var(--color-ember)' }}
          >
            {busy ? 'Adding…' : 'Add'}
          </button>
        </div>
      </div>

      {note && (
        <p
          className={
            'mt-2 text-sm text-center ' +
            (phase === 'failed'
              ? 'text-[color:var(--color-ember)]'
              : 'text-[color:var(--color-ink-soft)]')
          }
        >
          {note}
        </p>
      )}
    </div>
  );
}

function looksLikeUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function labelFor(status: string): string {
  switch (status) {
    case 'queued': return 'Queued…';
    case 'scraping': return 'Fetching the page…';
    case 'extracting': return 'Sifting the signal…';
    default: return 'Working…';
  }
}

// Translate the job's raw error into something legible, but keep the underlying
// detail visible — it's the only diagnostic the user can read back to us.
function failureMessage(error?: string | null): string {
  if (!error) return 'Couldn’t process that link.';
  if (error.startsWith('daily_quota_exhausted')) {
    return 'Daily AI quota reached — try again tomorrow.';
  }
  const m = error.match(/^(\d{3})\b/);
  if (m) {
    const code = m[1];
    if (code === '400' || code === '403') {
      return `Sift’s AI key was rejected (${code}). Check GEMINI_API_KEY is set on the Worker. (${trim(error)})`;
    }
    if (code === '429') return 'AI rate limit hit — try again in a minute.';
  }
  return `Failed: ${trim(error)}`;
}

const trim = (s: string) => (s.length > 160 ? s.slice(0, 160) + '…' : s);

function messageFor(code?: string): string {
  switch (code) {
    case 'no_url': return 'No link found in that text.';
    case 'unauthenticated': return 'Your session expired. Sign in again.';
    case 'no_account': return 'No account to save into yet.';
    default: return 'Couldn’t add that link. Try again.';
  }
}
