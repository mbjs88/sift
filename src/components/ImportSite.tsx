// Import a whole creator's catalogue — but on YOUR terms.
//
// Flow: "Find" previews how many recipes exist (no AI, nothing queued) and shows
// a sample. You then choose how many to import. Queued recipes drain gently
// while the app is open (or overnight via the cron), capped daily. You can
// Pause draining or Clear the queue at any time.
//
// client:only — reads the browser session the shell seeded.

import { useEffect, useRef, useState } from 'react';

function sessionToken(): string | null {
  const m = document.cookie.match(/(?:^|;\s*)sb-access-token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PAUSE_KEY = 'sift-drain-paused';

interface Preview { discovered: number; newCount: number; skipped: number; sample: string[]; }

export default function ImportSite() {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [limit, setLimit] = useState(50);
  const [queued, setQueued] = useState(0);
  const [paused, setPaused] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const mounted = useRef(true);
  const draining = useRef(false);
  const pausedRef = useRef(false);

  useEffect(() => {
    mounted.current = true;
    pausedRef.current = localStorage.getItem(PAUSE_KEY) === '1';
    setPaused(pausedRef.current);
    void refreshQueue().then(() => { if (!pausedRef.current) void drain(); });
    return () => { mounted.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshQueue() {
    const token = sessionToken();
    if (!token) return;
    const res = await fetch('/api/queue', { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) return;
    const c = (await res.json()) as Record<string, number>;
    if (mounted.current) setQueued(c.queued ?? 0);
  }

  async function drain() {
    if (draining.current || pausedRef.current) return;
    const token = sessionToken();
    if (!token) return;
    draining.current = true;
    try {
      while (mounted.current && !pausedRef.current) {
        const res = await fetch('/api/ingest-next', {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
        });
        if (!res.ok) break;
        const r = (await res.json()) as {
          remaining?: number; done?: boolean; capped?: boolean; skipped?: boolean; cap?: number;
        };
        if (typeof r.remaining === 'number' && mounted.current) setQueued(r.remaining);
        if (r.capped) { setNote(`Daily limit reached (${r.cap}/day). ${r.remaining ?? 0} left for next time.`); break; }
        if (r.done || (r.remaining === 0 && !r.skipped)) { setNote(null); break; }
        setNote(`Reading ${r.remaining ?? 0} more…`);
        await sleep(r.skipped ? 200 : 1500);
      }
    } finally {
      draining.current = false;
    }
  }

  function togglePause() {
    const next = !pausedRef.current;
    pausedRef.current = next;
    setPaused(next);
    localStorage.setItem(PAUSE_KEY, next ? '1' : '0');
    if (!next) { setNote(null); void drain(); }
    else setNote('Paused. Nothing new will be processed until you resume.');
  }

  async function clearQueue() {
    const token = sessionToken();
    if (!token) return;
    setBusy(true);
    try {
      const res = await fetch('/api/queue', { method: 'DELETE', headers: { authorization: `Bearer ${token}` } });
      const r = (await res.json().catch(() => ({}))) as { cleared?: number };
      if (mounted.current) {
        setQueued(0);
        setNote(`Cleared ${r.cleared ?? 0} queued recipes. (Already-saved ones are untouched.)`);
      }
    } finally {
      setBusy(false);
    }
  }

  async function find() {
    const link = url.trim();
    if (!link || busy) return;
    if (!/^https?:\/\//i.test(link)) { setNote('Paste a site or blog URL.'); return; }
    const token = sessionToken();
    if (!token) { setNote('Sign in first.'); return; }
    setBusy(true);
    setPreview(null);
    setNote('Finding recipes…');
    try {
      const res = await fetch('/api/import-collection', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ url: link, dryRun: true }),
      });
      const r = (await res.json().catch(() => ({}))) as Partial<Preview> & { message?: string };
      if (!res.ok || !r.discovered) { setNote(r.message ?? 'No recipes found there.'); return; }
      setPreview({ discovered: r.discovered, newCount: r.newCount ?? 0, skipped: r.skipped ?? 0, sample: r.sample ?? [] });
      setLimit(Math.min(r.newCount ?? 0, 50));
      setNote(null);
    } catch {
      setNote('Couldn’t reach that site.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmImport(all: boolean) {
    if (!preview) return;
    const token = sessionToken();
    if (!token) return;
    const n = all ? preview.newCount : Math.max(0, Math.min(limit, preview.newCount));
    if (n === 0) { setNote('Nothing new to import.'); setPreview(null); return; }
    setBusy(true);
    setNote('Queuing…');
    try {
      const res = await fetch('/api/import-collection', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ url: url.trim(), limit: n }),
      });
      const r = (await res.json().catch(() => ({}))) as { queued?: number };
      setPreview(null);
      setUrl('');
      setNote(`Queued ${r.queued ?? 0} recipes.`);
      await refreshQueue();
      if (!pausedRef.current) void drain();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="glass flex flex-col gap-3 px-4 py-4">
        <div className="flex items-center justify-between text-sm text-[color:var(--color-ink-soft)]">
          <span className="uppercase tracking-[0.14em] text-xs">Import a whole site</span>
          {queued > 0 && (
            <span className="flex items-center gap-2 text-xs">
              <span>{queued} queued</span>
              <button onClick={togglePause} className="underline underline-offset-2 hover:text-[color:var(--color-ink)]">
                {paused ? 'Resume' : 'Pause'}
              </button>
              <button onClick={clearQueue} disabled={busy} className="underline underline-offset-2 hover:text-[color:var(--color-ember)]">
                Clear
              </button>
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') find(); }}
            inputMode="url"
            autoComplete="off"
            placeholder="A recipe blog, e.g. andy-cooks.com/blogs/recipes"
            className="flex-1 bg-transparent outline-none text-[color:var(--color-ink)] placeholder:text-[color:var(--color-ink-soft)] text-[15px]"
          />
          <button onClick={find} disabled={busy} className="action px-5 py-2 text-sm font-medium">
            {busy && !preview ? 'Finding…' : 'Find'}
          </button>
        </div>

        {preview && (
          <div className="rounded-2xl border glass-hairline bg-[color:var(--glass-bg)] px-3 py-3 flex flex-col gap-3">
            <p className="text-sm text-[color:var(--color-ink)]">
              Found <strong>{preview.discovered}</strong> recipes
              {preview.skipped > 0 && <span className="text-[color:var(--color-ink-soft)]"> · {preview.skipped} already saved</span>}
              {' · '}<strong>{preview.newCount}</strong> new.
            </p>
            {preview.sample.length > 0 && (
              <p className="text-xs text-[color:var(--color-ink-soft)] capitalize">
                e.g. {preview.sample.slice(0, 5).join(' · ')}…
              </p>
            )}
            <div className="flex items-center gap-2 flex-wrap">
              <label className="text-sm text-[color:var(--color-ink-soft)]">Import first</label>
              <input
                type="number" min={1} max={preview.newCount} value={limit}
                onChange={(e) => setLimit(Math.max(1, Math.min(preview.newCount, Number(e.target.value) || 1)))}
                className="w-20 rounded-lg border glass-hairline bg-transparent px-2 py-1 text-sm text-[color:var(--color-ink)] outline-none"
              />
              <button onClick={() => confirmImport(false)} disabled={busy} className="action px-4 py-1.5 text-sm font-medium">
                Import {Math.min(limit, preview.newCount)}
              </button>
              <button
                onClick={() => confirmImport(true)} disabled={busy}
                className="rounded-full px-4 py-1.5 text-sm border glass-hairline text-[color:var(--color-ink-soft)] hover:text-[color:var(--color-ink)]"
              >
                Import all {preview.newCount}
              </button>
              <button onClick={() => { setPreview(null); setNote(null); }} className="text-sm text-[color:var(--color-ink-soft)] hover:text-[color:var(--color-ink)] px-2">
                Cancel
              </button>
            </div>
          </div>
        )}

        {queued > 0 && !paused && (
          <div className="h-1 w-full overflow-hidden rounded-full bg-[color:var(--color-stone-warm)]/50">
            <div className="h-full rounded-full animate-pulse" style={{ width: '100%', background: 'var(--color-ember)' }} />
          </div>
        )}
      </div>

      {note && <p className="mt-2 text-sm text-center text-[color:var(--color-ink-soft)]">{note}</p>}
    </div>
  );
}
