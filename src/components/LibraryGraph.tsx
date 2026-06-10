// The whole-library map, full-page: the graph owns the entire viewport with no
// card or border — it floats behind the frosted header and the pill nav.
// Source hubs cluster the items that came from each page; shared ingredients
// draw the cross-links. Rendering is our own ForceCanvas (no external dep).

import { useCallback, useEffect, useMemo, useState } from 'react';
import ForceCanvas, { type FLink, type FNode } from './ForceCanvas';

function sessionToken(): string | null {
  const m = document.cookie.match(/(?:^|;\s*)sb-access-token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

type NodeType = 'recipe' | 'technique' | 'wisdom' | 'source';
interface GNode { id: string; type: NodeType; label: string; url?: string | null; }
interface GLink { source: string; target: string; kind: 'source' | 'shared'; }
interface GraphData { nodes: GNode[]; links: GLink[]; counts: Record<NodeType, number>; }

const COLOR: Record<NodeType, string> = {
  source: '#6b6459',     // ink-soft — the hub a save came from
  recipe: '#b07d56',     // warm terracotta
  technique: '#7d8b6a',  // sage
  wisdom: '#c2a878',     // wheat
};

function isDark(): boolean {
  if (typeof document !== 'undefined') {
    if (document.documentElement.classList.contains('theme-dark')) return true;
    if (document.documentElement.classList.contains('theme-light')) return false;
  }
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches;
}
function useInkColor(): string {
  const get = () => (isDark() ? '#f4ede2' : '#2b2722');
  const [ink, setInk] = useState(get);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => setInk(get());
    mq.addEventListener?.('change', on);
    const obs = new MutationObserver(on);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => { mq.removeEventListener?.('change', on); obs.disconnect(); };
  }, []);
  return ink;
}

export default function LibraryGraph(_props: { embedded?: boolean }) {
  const [data, setData] = useState<GraphData | null>(null);
  const [state, setState] = useState<'loading' | 'idle' | 'error'>('loading');
  const ink = useInkColor();

  const load = useCallback(async () => {
    const token = sessionToken();
    if (!token) { setState('error'); return; }
    setState('loading');
    try {
      const res = await fetch('/api/graph', { headers: { authorization: `Bearer ${token}` } });
      if (!res.ok) { setState('error'); return; }
      setData((await res.json()) as GraphData);
      setState('idle');
    } catch {
      setState('error');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const total = data ? data.nodes.filter((n) => n.type !== 'source').length : 0;

  const fNodes: FNode[] = useMemo(() =>
    (data?.nodes ?? []).map((n) => ({
      id: n.id,
      label: n.label,
      url: n.url,
      color: COLOR[n.type],
      r: n.type === 'source' ? 6 : 4.5,
      ring: n.type === 'source' ? ink : null,
      alwaysLabel: n.type === 'source',
    })), [data, ink]);

  const fLinks: FLink[] = useMemo(() =>
    (data?.links ?? []).map((l) => ({
      source: l.source,
      target: l.target,
      color: l.kind === 'shared' ? 'rgba(194,104,63,0.25)' : 'rgba(120,110,98,0.30)',
      rest: l.kind === 'shared' ? 75 : 38,
    })), [data]);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 0 }}>
      {state === 'idle' && data && total > 0 && (
        <ForceCanvas
          nodes={fNodes}
          links={fLinks}
          ink={ink}
          onNodeClick={(n) => { if (n.url) window.open(n.url, '_blank', 'noopener'); }}
        />
      )}

      {state === 'loading' && (
        <Center><p className="muted" style={{ margin: 0 }}>Mapping your knowledge…</p></Center>
      )}
      {state === 'error' && (
        <Center>
          <p className="muted" style={{ margin: 0 }}>
            Couldn’t load the map.{' '}
            <button onClick={load} className="chip" style={{ cursor: 'pointer' }}>Retry</button>
          </p>
        </Center>
      )}
      {state === 'idle' && data && total === 0 && (
        <Center>
          <p className="muted" style={{ margin: 0, maxWidth: '30ch', textAlign: 'center' }}>
            Nothing saved yet. Add a recipe from the Home tab and your map will grow here.
          </p>
        </Center>
      )}

      {state === 'idle' && data && total > 0 && (
        <div
          className="glass-2"
          style={{
            position: 'absolute', left: '50%', transform: 'translateX(-50%)',
            bottom: 'calc(92px + env(safe-area-inset-bottom))',
            display: 'flex', flexWrap: 'wrap', justifyContent: 'center',
            gap: '4px 14px', alignItems: 'center',
            padding: '8px 16px', borderRadius: 999, maxWidth: 'calc(100% - 28px)',
            fontSize: 'var(--t-xs)', color: 'var(--color-ink-soft)',
          }}
        >
          <Legend color={COLOR.source} label={`Sources ${data.counts.source}`} ring={ink} />
          <Legend color={COLOR.recipe} label={`Recipes ${data.counts.recipe}`} />
          <Legend color={COLOR.technique} label={`Techniques ${data.counts.technique}`} />
          <Legend color={COLOR.wisdom} label={`Wisdom ${data.counts.wisdom}`} />
          <button onClick={load} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', textDecoration: 'underline', textUnderlineOffset: 2, font: 'inherit', padding: 0 }}>
            Refresh
          </button>
        </div>
      )}
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', padding: 24 }}>
      {children}
    </div>
  );
}

function Legend({ color, label, ring }: { color: string; label: string; ring?: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
      <span style={{ width: 10, height: 10, borderRadius: '50%', background: color, boxShadow: ring ? `inset 0 0 0 1px ${ring}` : undefined }} />
      {label}
    </span>
  );
}
