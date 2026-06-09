// Import a whole creator's catalogue, then let it drain gently.
//
// "Import" discovers every recipe on the site and queues them (deduped) — cheap,
// no AI yet. The drainer then processes the queue one recipe at a time WHILE THE
// APP IS OPEN, pausing at a daily cap so the free tier is never blown. Open Sift
// tomorrow and it picks up where it left off. (A truly unattended nightly run
// would need a privileged background key, which this app intentionally avoids.)
//
// client:only — reads the browser session the shell seeded.

import { useEffect, useRef, useState } from 'react';

function sessionToken(): string | null {
  const m = document.cookie.match(/(?:^|;\s*)sb-access-token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function ImportSite() {
  const [url, setUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [capped, setCapped] = useState(false);

  const mounted = useRef(true);
  const draining = useRef(false);

  // On open, quietly resume draining any existing backlog.
  useEffect(() => {
    mounted.current = true;
    void drain();
    return () => { mounted.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function drain() {
    if (draining.current) return;
    const token = sessionToken();
    if (!token) return;
    draining.current = true;
    try {
      while (mounted.current) {
        const res = await fetch('/api/ingest-next', {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
        });
        if (!res.ok) break;
        const r = (await res.json()) as {
          remaining?: number; done?: boolean; capped?: boolean;
          status?: string; skipped?: boolean; cap?: number;
        };
        if (typeof r.remaining === 'number') setRemaining(r.remaining);

        if (r.capped) {
          setCapped(true);
          setNote(`Daily limit reached (${r.cap}/day). ${r.remaining ?? 0} left — they’ll continue next time you open Sift.`);
          break;
        }
        if (r.done || (r.remaining === 0 && !r.skipped)) {
          setNote(r.remaining === 0 ? null : note);
          break;
        }
        setCapped(false);
        setNote(`Reading ${r.remaining ?? 0} more…`);
        await sleep(r.skipped ? 200 : 1500);  // gentle pace
      }
    } finally {
      draining.current = false;
    }
  }

  async function importSite() {
    const link = url.trim();
    if (!link || importing) return;
    if (!/^https?:\/\//i.test(link)) { setNote('Paste a site or blog URL.'); return; }
    const token = sessionToken();
    if (!token) { setNote('Sign in first.'); return; }

    setImporting(true);
    setNote('Finding recipes…');
    try {
      const res = await fetch('/api/import-collection', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ url: link }),
      });
      const r = (await res.json().catch(() => ({}))) as {
        discovered?: number; queued?: number; skipped?: number; message?: string;
      };
      if (!res.ok) { setNote('Couldn’t import that site.'); return; }
      if (!r.discovered) { setNote(r.message ?? 'No recipes found there.'); return; }

      const queued = r.queued ?? 0;
      const already = r.skipped ?? 0;
      setUrl('');
      setNote(
        queued > 0
          ? `Found ${r.discovered} recipes — queued ${queued}${already ? `, ${already} already saved` : ''}. Reading them now…`
          : `All ${r.discovered} recipes are already in your library.`,
      );
      void drain();
    } catch {
      setNote('Something went wrong importing that site.');
    } finally {
      setImporting(false);
    }
  }

  const showProgress = (remaining ?? 0) > 0;

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="glass flex flex-col gap-3 px-4 py-4">
        <div className="flex items-center gap-2 text-sm text-[color:var(--color-ink-soft)]">
          <span className="uppercase tracking-[0.14em] text-xs">Import a whole site</span>
        </div>

        <div className="flex items-center gap-2">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') importSite(); }}
            inputMode="url"
            autoComplete="off"
            placeholder="A recipe blog, e.g. andy-cooks.com/blogs/recipes"
            className="flex-1 bg-transparent outline-none text-[color:var(--color-ink)] placeholder:text-[color:var(--color-ink-soft)] text-[15px]"
          />
          <button
            onClick={importSite}
            disabled={importing}
            className="action px-5 py-2 text-sm font-medium"
          >
            {importing ? 'Finding…' : 'Import'}
          </button>
        </div>

        {showProgress && (
          <div className="h-1 w-full overflow-hidden rounded-full bg-[color:var(--color-stone-warm)]/50">
            <div
              className={'h-full rounded-full ' + (capped ? '' : 'animate-pulse')}
              style={{ width: '100%', background: capped ? 'var(--color-ink-soft)' : 'var(--color-ember)' }}
            />
          </div>
        )}
      </div>

      {note && (
        <p className="mt-2 text-sm text-center text-[color:var(--color-ink-soft)]">{note}</p>
      )}
    </div>
  );
}
