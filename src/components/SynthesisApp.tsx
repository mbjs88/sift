// The RAG search interface (spec §5 Phase 3). One calm search bar that flips
// between free synthesis and Pantry Rescue, the knowledge graph that pulls the
// retrieved nodes together, and the synthesised guide rendered as Markdown.
//
// Mounted client:only — it reads the browser session and talks to /api/synthesize.

import { useState } from 'react';
import { marked } from 'marked';
import KnowledgeGraph from './KnowledgeGraph';
import type { SynthesisMode, SynthesisResponse } from '../lib/synthesis';

// The signed-in Supabase session token the browser already holds. Until Google
// OAuth is wired (Phase 0 button), this is the single seam to swap in the real
// session getter.
function sessionToken(): string | null {
  const m = document.cookie.match(/(?:^|;\s*)sb-access-token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

const PLACEHOLDER: Record<SynthesisMode, string> = {
  synthesis: 'Generate a workflow for high-hydration dough in a high-heat stone oven…',
  pantry: 'chicken, day-old rice, a lemon',
};

export default function SynthesisApp() {
  const [mode, setMode] = useState<SynthesisMode>('synthesis');
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SynthesisResponse | null>(null);

  async function run() {
    const q = prompt.trim();
    if (!q || loading) return;

    const token = sessionToken();
    if (!token) {
      setError('Sign in to search your knowledge.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/synthesize', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(
          mode === 'pantry' ? { prompt: q, mode, onHand: q } : { prompt: q, mode },
        ),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setError(messageFor(body.error));
        setResult(null);
        return;
      }
      setResult((await res.json()) as SynthesisResponse);
    } catch {
      setError('Something went wrong. Try again.');
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  const guideHtml = result ? (marked.parse(result.guide, { async: false }) as string) : '';

  return (
    <div className="w-full max-w-2xl mx-auto flex flex-col gap-6">
      <div className="flex gap-2 self-center text-sm">
        <Toggle active={mode === 'synthesis'} onClick={() => setMode('synthesis')}>Synthesis</Toggle>
        <Toggle active={mode === 'pantry'} onClick={() => setMode('pantry')}>Pantry Rescue</Toggle>
      </div>

      <div className="glass-strong flex items-center gap-2 px-3 py-2.5">
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') run(); }}
          placeholder={PLACEHOLDER[mode]}
          className="flex-1 bg-transparent outline-none text-[color:var(--color-ink)] placeholder:text-[color:var(--color-ink-soft)] text-[15px] pl-2"
        />
        <button
          onClick={run}
          disabled={loading}
          className="action px-5 py-2 text-sm font-medium"
        >
          {loading ? 'Sifting…' : 'Sift'}
        </button>
      </div>

      {error && <p className="text-sm text-center text-[color:var(--color-ink-soft)]">{error}</p>}

      {result && (
        <>
          <KnowledgeGraph nodes={result.nodes} />
          <article
            className="prose prose-stone max-w-none prose-headings:font-light prose-a:text-[color:var(--color-ink)]"
            dangerouslySetInnerHTML={{ __html: guideHtml }}
          />
        </>
      )}
    </div>
  );
}

function Toggle(
  { active, onClick, children }:
  { active: boolean; onClick: () => void; children: React.ReactNode },
) {
  return (
    <button
      onClick={onClick}
      className={
        'rounded-full px-4 py-1.5 border transition-all active:scale-95 ' +
        (active
          ? 'action border-transparent'
          : 'glass glass-hairline text-[color:var(--color-ink-soft)] hover:text-[color:var(--color-ink)]')
      }
      style={active ? undefined : { borderRadius: '9999px' }}
    >
      {children}
    </button>
  );
}

function messageFor(code?: string): string {
  switch (code) {
    case 'unauthenticated': return 'Your session expired. Sign in again.';
    case 'no_account': return 'No account to search yet.';
    case 'empty_prompt': return 'Type something to sift.';
    default: return 'Search failed. Try again.';
  }
}
