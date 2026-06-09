// Add a source straight from the website — the on-screen twin of the PWA
// share_target. This is built for "save it and move on", not "watch it work":
// pasting a link queues it instantly, clears the box, and the item processes in
// the background while you add the next one. Each queued item shows a live
// status + progress bar and can be dismissed.
//
// Auth: POST {url} as JSON with the bearer token (same as synthesis; no
// form-POST, so no CSRF surface). Status comes from the ingestion_jobs row,
// read under the caller's RLS.
//
// Mounted client:only — it reads the browser session the shell already seeded.

import { useRef, useState } from 'react';
import { browserSupabase } from '../lib/authClient';

function sessionToken(): string | null {
  const m = document.cookie.match(/(?:^|;\s*)sb-access-token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

type Phase = 'submitting' | 'queued' | 'scraping' | 'extracting' | 'working' | 'done' | 'failed';

interface Item {
  id: string;        // local id (stable for React keys + cancellation)
  url: string;
  label: string;     // host, for a compact display
  phase: Phase;
  note?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function AddSource() {
  const [url, setUrl] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [hint, setHint] = useState<string | null>(null);
  const cancelled = useRef<Set<string>>(new Set());

  function patch(id: string, p: Partial<Item>) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...p } : it)));
  }

  function dismiss(id: string) {
    cancelled.current.add(id);           // stop its poll loop
    setItems((prev) => prev.filter((it) => it.id !== id));
  }

  async function add() {
    const link = url.trim();
    if (!link) return;
    if (!looksLikeUrl(link)) {
      setHint('That doesn’t look like a link.');
      return;
    }
    const token = sessionToken();
    if (!token) {
      setHint('Sign in to add a source.');
      return;
    }

    const id = crypto.randomUUID();
    setItems((prev) => [{ id, url: link, label: hostOf(link), phase: 'submitting' }, ...prev]);
    setUrl('');          // free the box immediately — keep adding
    setHint(null);

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
      const body = (await res.json().catch(() => ({}))) as {
        jobId?: string; error?: string; duplicate?: boolean; status?: string;
      };
      if (!res.ok || !body.jobId) {
        patch(id, { phase: 'failed', note: messageFor(body.error) });
        return;
      }
      // Already saved (or already in flight) — don't re-add, just say so.
      if (body.duplicate) {
        if (body.status === 'done') {
          patch(id, { phase: 'done', note: 'Already in your library.' });
        } else {
          patch(id, { phase: 'working', note: 'Already being added…' });
          void pollJob(id, body.jobId);
        }
        return;
      }
      patch(id, { phase: 'working', note: 'Reading…' });
      void pollJob(id, body.jobId);
    } catch {
      patch(id, { phase: 'failed', note: 'Something went wrong. Try again.' });
    }
  }

  // Watch one job's row until it resolves, the user dismisses it, or we give up.
  async function pollJob(localId: string, jobId: string) {
    const supa = browserSupabase();
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      if (cancelled.current.has(localId)) return;
      await sleep(2000);
      if (cancelled.current.has(localId)) return;

      const { data } = await supa
        .from('ingestion_jobs')
        .select('status, error')
        .eq('id', jobId)
        .single();
      const s = data?.status as Phase | undefined;
      if (s === 'done') {
        patch(localId, { phase: 'done', note: 'Saved.' });
        return;
      }
      if (s === 'failed') {
        patch(localId, { phase: 'failed', note: failureMessage(data?.error as string | null) });
        return;
      }
      if (s) patch(localId, { phase: s, note: labelFor(s) });
    }
    // Past the watch window — it keeps running server-side and will land.
    patch(localId, { phase: 'done', note: 'Still saving — it’ll appear shortly.' });
  }

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div
        className="glass flex flex-col gap-3 px-4 py-4"
        style={{ boxShadow: 'var(--glass-shadow), inset 0 0 0 1px rgba(194,104,63,0.18)' }}
      >
        <div className="flex items-center gap-2 text-sm text-[color:var(--color-ink-soft)]">
          <span
            className="grid place-items-center w-5 h-5 rounded-full text-white text-base leading-none shadow-sm"
            style={{ background: 'var(--color-ember)' }}
            aria-hidden="true"
          >
            +
          </span>
          <span className="uppercase tracking-[0.14em] text-xs">Add a source</span>
        </div>

        <div className="flex items-center gap-2">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
            inputMode="url"
            autoComplete="off"
            placeholder="Paste a recipe or YouTube link…"
            className="flex-1 bg-transparent outline-none text-[color:var(--color-ink)] placeholder:text-[color:var(--color-ink-soft)] text-[15px]"
          />
          <button
            onClick={add}
            className="rounded-full px-5 py-2 text-sm font-medium text-white shadow-sm transition-transform active:scale-95"
            style={{ background: 'var(--color-ember)' }}
          >
            Add
          </button>
        </div>
      </div>

      {hint && (
        <p className="mt-2 text-sm text-center text-[color:var(--color-ember)]">{hint}</p>
      )}

      {items.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2">
          {items.map((it) => (
            <SourceRow key={it.id} item={it} onDismiss={() => dismiss(it.id)} />
          ))}
        </ul>
      )}
    </div>
  );
}

function SourceRow({ item, onDismiss }: { item: Item; onDismiss: () => void }) {
  const failed = item.phase === 'failed';
  const done = item.phase === 'done';
  const active = !failed && !done;
  const pct = progressFor(item.phase);

  return (
    <li className="rounded-2xl border glass-hairline bg-[color:var(--glass-bg)] px-3 py-2.5 rise">
      <div className="flex items-center gap-3">
        <span className="flex-1 min-w-0 truncate text-sm text-[color:var(--color-ink)]" title={item.url}>
          {item.label}
        </span>
        <span
          className={
            'text-xs whitespace-nowrap ' +
            (failed ? 'text-[color:var(--color-ember)]' : 'text-[color:var(--color-ink-soft)]')
          }
        >
          {done ? '✓ ' : ''}{item.note ?? labelFor(item.phase)}
        </span>
        <button
          onClick={onDismiss}
          aria-label={active ? 'Dismiss' : 'Remove'}
          className="grid place-items-center w-6 h-6 rounded-full text-[color:var(--color-ink-soft)] hover:bg-[color:var(--color-stone-warm)]/60 transition-colors"
          title={active ? 'Stop watching this' : 'Remove'}
        >
          ×
        </button>
      </div>

      <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-[color:var(--color-stone-warm)]/50">
        <div
          className={'h-full rounded-full transition-[width] duration-700 ease-out ' + (active ? 'animate-pulse' : '')}
          style={{
            width: `${pct}%`,
            background: failed ? 'transparent' : 'var(--color-ember)',
          }}
        />
      </div>
    </li>
  );
}

function progressFor(phase: Phase): number {
  switch (phase) {
    case 'submitting': return 8;
    case 'queued': return 20;
    case 'scraping': return 45;
    case 'working': return 55;
    case 'extracting': return 80;
    case 'done': return 100;
    case 'failed': return 100;
  }
}

function hostOf(s: string): string {
  try { return new URL(s).hostname.replace(/^www\./, ''); } catch { return s; }
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
    case 'submitting': return 'Adding…';
    case 'queued': return 'Queued…';
    case 'scraping': return 'Fetching the page…';
    case 'working': return 'Reading…';
    case 'extracting': return 'Sifting the signal…';
    case 'done': return 'Saved.';
    default: return 'Working…';
  }
}

// Translate the job's raw error into something legible, keeping the underlying
// detail — it's the only diagnostic the user can read back to us.
function failureMessage(error?: string | null): string {
  if (!error) return 'Couldn’t process that link.';
  if (error.startsWith('daily_quota_exhausted')) {
    return 'Daily AI quota reached — try again tomorrow.';
  }
  if (/scrape timed out|scrape network error/i.test(error)) {
    return 'That page wouldn’t load in time — try another link.';
  }
  const m = error.match(/^(\d{3})\b/);
  if (m) {
    const code = m[1];
    if (code === '400' || code === '403') {
      return `Sift’s AI key was rejected (${code}). Check GEMINI_API_KEY. (${trim(error)})`;
    }
    if (code === '429') return 'AI rate limit hit — try again in a minute.';
    if (code === '504') return 'The AI took too long (likely a long video) — try a shorter source.';
    if (code === '503') return 'Couldn’t reach the AI service — retry in a moment.';
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
