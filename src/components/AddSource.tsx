// Add one source — by link or by pasting raw text.
//
// LINK: paste/share a URL → we fetch a quick metadata preview (title, site,
// image) so you can confirm it's the right page → then it's queued and read.
// PASTE: when a page won't parse, paste the recipe text itself and Sift extracts
// straight from that (no scrape, no source URL).
//
// Shared from Android? The PWA share_target (GET /app?url=…) lands here; we read
// the query, prefill, and jump straight to the preview.
//
// client:only — reads the browser session the shell seeded.

import { useEffect, useRef, useState } from 'react';
import { browserSupabase } from '../lib/authClient';

function sessionToken(): string | null {
  const m = document.cookie.match(/(?:^|;\s*)sb-access-token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}
type Phase = 'submitting' | 'queued' | 'scraping' | 'extracting' | 'working' | 'done' | 'failed';
interface Item { id: string; label: string; phase: Phase; note?: string; }
interface LinkPreview { canonical: string; title: string; site: string; image: string | null; kind: string; partial?: boolean; }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function AddSource() {
  const [mode, setMode] = useState<'link' | 'text'>('link');
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<LinkPreview | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [hint, setHint] = useState<string | null>(null);
  const cancelled = useRef<Set<string>>(new Set());

  // Android share → /app?url=… (or the link inside ?text=). Prefill + preview.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const shared = q.get('url') || firstUrl(q.get('text')) || firstUrl(q.get('title'));
    if (shared) {
      setMode('link');
      setUrl(shared);
      history.replaceState(null, '', window.location.pathname);
      void preview(shared);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function patch(id: string, p: Partial<Item>) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...p } : it)));
  }
  function dismiss(id: string) {
    cancelled.current.add(id);
    setItems((prev) => prev.filter((it) => it.id !== id));
  }

  // Step 1 (link): fetch metadata and show a confirmation card.
  async function preview(rawLink?: string) {
    const link = (rawLink ?? url).trim();
    if (!link || busy) return;
    if (!looksLikeUrl(link)) { setHint('That doesn’t look like a link.'); return; }
    const token = sessionToken();
    if (!token) { setHint('Sign in to add a source.'); return; }
    setHint(null);
    setBusy(true);
    setPending({ canonical: link, title: 'Checking…', site: hostOf(link), image: null, kind: 'article' });
    try {
      const res = await fetch(`/api/link-preview?url=${encodeURIComponent(link)}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) { setPending({ canonical: link, title: hostOf(link), site: hostOf(link), image: null, kind: 'article', partial: true }); return; }
      setPending((await res.json()) as LinkPreview);
    } catch {
      setPending({ canonical: link, title: hostOf(link), site: hostOf(link), image: null, kind: 'article', partial: true });
    } finally {
      setBusy(false);
    }
  }

  // Step 2 (link): confirmed → queue + watch.
  async function confirmLink() {
    if (!pending) return;
    const link = pending.canonical;
    setPending(null);
    setUrl('');
    await submit({ url: link }, hostOf(link));
  }

  async function submitPaste() {
    const body = text.trim();
    if (body.length < 20) { setHint('Paste a bit more recipe text first.'); return; }
    setHint(null);
    setText('');
    await submit({ rawText: body }, firstLine(body));
  }

  async function submit(payload: { url?: string; rawText?: string }, label: string) {
    const token = sessionToken();
    if (!token) { setHint('Sign in to add a source.'); return; }
    const id = crypto.randomUUID();
    setItems((prev) => [{ id, label, phase: 'submitting', note: 'Adding…' }, ...prev]);
    try {
      const res = await fetch('/api/ingest', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      const r = (await res.json().catch(() => ({}))) as { jobId?: string; error?: string; duplicate?: boolean; status?: string };
      if (!res.ok || !r.jobId) { patch(id, { phase: 'failed', note: messageFor(r.error) }); return; }
      if (r.duplicate && r.status === 'done') { patch(id, { phase: 'done', note: 'Already in your library.' }); return; }
      patch(id, { phase: 'working', note: 'Reading…' });
      void pollJob(id, r.jobId);
    } catch {
      patch(id, { phase: 'failed', note: 'Something went wrong. Try again.' });
    }
  }

  async function pollJob(localId: string, jobId: string) {
    const supa = browserSupabase();
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      if (cancelled.current.has(localId)) return;
      await sleep(2000);
      if (cancelled.current.has(localId)) return;
      const { data } = await supa.from('ingestion_jobs').select('status, error').eq('id', jobId).single();
      const s = data?.status as Phase | undefined;
      if (s === 'done') { patch(localId, { phase: 'done', note: 'Saved.' }); return; }
      if (s === 'failed') { patch(localId, { phase: 'failed', note: failureMessage(data?.error as string | null) }); return; }
      if (s) patch(localId, { phase: s, note: labelFor(s) });
    }
    patch(localId, { phase: 'done', note: 'Still saving — it’ll appear shortly.' });
  }

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="glass flex flex-col gap-3 px-4 py-4" style={{ boxShadow: 'var(--glass-shadow), inset 0 0 0 1px rgba(194,104,63,0.18)' }}>
        <div className="flex items-center justify-between">
          <span className="uppercase tracking-[0.14em] text-xs text-[color:var(--color-ink-soft)]">Add a recipe</span>
          <div className="flex rounded-full p-0.5 text-xs" style={{ background: 'var(--glass-hairline)' }}>
            <ModeTab active={mode === 'link'} onClick={() => setMode('link')}>Link</ModeTab>
            <ModeTab active={mode === 'text'} onClick={() => setMode('text')}>Paste text</ModeTab>
          </div>
        </div>

        {mode === 'link' && !pending && (
          <div className="flex items-center gap-2">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') preview(); }}
              inputMode="url" autoComplete="off"
              placeholder="Paste a recipe or YouTube link…"
              className="flex-1 bg-transparent outline-none text-[color:var(--color-ink)] placeholder:text-[color:var(--color-ink-soft)] text-[15px]"
            />
            <button onClick={() => preview()} disabled={busy} className="rounded-full px-5 py-2 text-sm font-medium text-white shadow-sm transition-transform active:scale-95" style={{ background: 'var(--color-ember)' }}>
              {busy ? '…' : 'Add'}
            </button>
          </div>
        )}

        {mode === 'link' && pending && (
          <div className="rounded-2xl border glass-hairline bg-[color:var(--glass-bg)] p-3 flex flex-col gap-3">
            <div className="flex items-center gap-3">
              {pending.image
                ? <img src={pending.image} alt="" className="w-12 h-12 rounded-xl object-cover flex-none" />
                : <span className="w-12 h-12 rounded-xl flex-none grid place-items-center text-lg" style={{ background: 'var(--glass-hairline)' }}>{pending.kind === 'youtube' ? '▶' : '🍳'}</span>}
              <div className="min-w-0">
                <p className="text-sm text-[color:var(--color-ink)] truncate">{pending.title}</p>
                <p className="text-xs text-[color:var(--color-ink-soft)] truncate">{pending.site}{pending.partial ? ' · couldn’t preview, but you can still add it' : ''}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={confirmLink} className="action px-4 py-1.5 text-sm font-medium">Add this</button>
              <button onClick={() => { setPending(null); }} className="text-sm text-[color:var(--color-ink-soft)] hover:text-[color:var(--color-ink)] px-2">Cancel</button>
            </div>
          </div>
        )}

        {mode === 'text' && (
          <div className="flex flex-col gap-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
              placeholder="Paste the full recipe text here — ingredients, steps, notes. Use this when a link won’t parse."
              className="w-full bg-transparent outline-none resize-y text-[color:var(--color-ink)] placeholder:text-[color:var(--color-ink-soft)] text-[15px] leading-relaxed"
            />
            <div className="flex justify-end">
              <button onClick={submitPaste} className="rounded-full px-5 py-2 text-sm font-medium text-white shadow-sm transition-transform active:scale-95" style={{ background: 'var(--color-ember)' }}>
                Add recipe
              </button>
            </div>
          </div>
        )}
      </div>

      {hint && <p className="mt-2 text-sm text-center text-[color:var(--color-ember)]">{hint}</p>}

      {items.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2">
          {items.map((it) => <SourceRow key={it.id} item={it} onDismiss={() => dismiss(it.id)} />)}
        </ul>
      )}
    </div>
  );
}

function ModeTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={'px-3 py-1 rounded-full transition-colors ' + (active ? 'text-[color:var(--color-ink)]' : 'text-[color:var(--color-ink-soft)]')}
      style={active ? { background: 'var(--glass-bg-strong)' } : undefined}
    >
      {children}
    </button>
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
        <span className="flex-1 min-w-0 truncate text-sm text-[color:var(--color-ink)]">{item.label}</span>
        <span className={'text-xs whitespace-nowrap ' + (failed ? 'text-[color:var(--color-ember)]' : 'text-[color:var(--color-ink-soft)]')}>
          {done ? '✓ ' : ''}{item.note ?? labelFor(item.phase)}
        </span>
        <button onClick={onDismiss} aria-label="Dismiss" className="grid place-items-center w-6 h-6 rounded-full text-[color:var(--color-ink-soft)] hover:bg-[color:var(--glass-hairline)] transition-colors">×</button>
      </div>
      <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-[color:var(--color-stone-warm)]/50">
        <div className={'h-full rounded-full transition-[width] duration-700 ease-out ' + (active ? 'animate-pulse' : '')} style={{ width: `${pct}%`, background: failed ? 'transparent' : 'var(--color-ember)' }} />
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
    default: return 100;
  }
}
function hostOf(s: string): string { try { return new URL(s).hostname.replace(/^www\./, ''); } catch { return s; } }
function firstLine(s: string): string { const l = s.split('\n').find((x) => x.trim())?.trim() ?? s; return l.length > 48 ? l.slice(0, 48) + '…' : l; }
function firstUrl(s: string | null): string | null { if (!s) return null; const m = s.match(/https?:\/\/[^\s]+/); return m ? m[0] : null; }
function looksLikeUrl(s: string): boolean { try { const u = new URL(s); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; } }

function labelFor(status: string): string {
  switch (status) {
    case 'submitting': return 'Adding…';
    case 'queued': return 'Queued…';
    case 'scraping': return 'Fetching…';
    case 'working': return 'Reading…';
    case 'extracting': return 'Sifting…';
    case 'done': return 'Saved.';
    default: return 'Working…';
  }
}
function failureMessage(error?: string | null): string {
  if (!error) return 'Couldn’t process that.';
  if (error.startsWith('daily_quota_exhausted')) return 'Daily AI quota reached — try again tomorrow.';
  if (/scrape timed out|scrape network error/i.test(error)) return 'That page wouldn’t load — try Paste text instead.';
  const m = error.match(/^(\d{3})\b/);
  if (m) {
    const code = m[1];
    if (code === '400' || code === '403') return `AI key was rejected (${code}). Check GEMINI_API_KEY.`;
    if (code === '429') return 'AI rate limit — try again in a minute.';
    if (code === '504') return 'The AI took too long — try a shorter source or Paste text.';
    if (code === '503') return 'Couldn’t reach the AI — retry shortly.';
  }
  return `Failed: ${error.length > 140 ? error.slice(0, 140) + '…' : error}`;
}
function messageFor(code?: string): string {
  switch (code) {
    case 'no_url': return 'No link found.';
    case 'unauthenticated': return 'Session expired. Sign in again.';
    case 'no_account': return 'No account to save into yet.';
    default: return 'Couldn’t add that. Try again.';
  }
}
