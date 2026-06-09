// Add a source straight from the website — the on-screen twin of the PWA
// share_target. Paste a recipe/video URL, POST it to /api/ingest as JSON with
// the bearer token (same auth as synthesis; no form-POST, so no CSRF surface),
// then watch the ingestion_jobs row move queued -> scraping -> extracting ->
// done under the caller's RLS.
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
  async function pollJob(jobId: string) {
    const supa = browserSupabase();
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      await sleep(2500);
      const { data } = await supa
        .from('ingestion_jobs')
        .select('status')
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
        setNote('Couldn’t process that link.');
        return;
      }
      if (s) setNote(labelFor(s));
    }
    // Still running past the watch window — it keeps going server-side.
    setPhase('done');
    setNote('Still processing — it’ll appear shortly.');
  }

  return (
    <div className="w-full max-w-2xl mx-auto flex flex-col gap-2">
      <div className="flex items-center gap-2 rounded-2xl border border-[color:var(--color-stone-warm)] bg-[color:var(--color-flour)] px-4 py-3 shadow-sm">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
          inputMode="url"
          autoComplete="off"
          placeholder="Paste a recipe or video link to add it…"
          className="flex-1 bg-transparent outline-none text-[color:var(--color-ink)] placeholder:text-[color:var(--color-ink-soft)]"
        />
        <button
          onClick={add}
          disabled={busy}
          className="rounded-xl bg-[color:var(--color-ink)] text-[color:var(--color-flour)] px-4 py-1.5 text-sm transition-transform active:scale-95 disabled:opacity-40"
        >
          {busy ? 'Adding…' : 'Add'}
        </button>
      </div>
      {note && (
        <p
          className={
            'text-sm text-center ' +
            (phase === 'failed'
              ? 'text-[color:var(--color-ember,#c2683f)]'
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

function messageFor(code?: string): string {
  switch (code) {
    case 'no_url': return 'No link found in that text.';
    case 'unauthenticated': return 'Your session expired. Sign in again.';
    case 'no_account': return 'No account to save into yet.';
    default: return 'Couldn’t add that link. Try again.';
  }
}
