// The whole-library map: a force graph of everything you've saved. Source hubs
// cluster the items that came from each page; shared ingredients/equipment draw
// the cross-links between clusters. Collapsible so it doesn't dominate the page.
//
// react-force-graph-2d touches window + canvas, so this is client:only.

import { useCallback, useEffect, useRef, useState } from 'react';
import ForceGraph2D from 'react-force-graph-2d';

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
    // also react to manual theme-class toggles
    const obs = new MutationObserver(on);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => { mq.removeEventListener?.('change', on); obs.disconnect(); };
  }, []);
  return ink;
}

export default function LibraryGraph({ embedded = false }: { embedded?: boolean }) {
  const fgRef = useRef<any>(null);
  const [open, setOpen] = useState(embedded);
  const [data, setData] = useState<GraphData | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
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

  // Load lazily the first time the map is opened.
  useEffect(() => {
    if (open && !data && state !== 'loading') void load();
  }, [open, data, state, load]);

  const total = data ? data.nodes.filter((n) => n.type !== 'source').length : null;

  return (
    <div className="w-full max-w-2xl mx-auto">
      {!embedded && (
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 text-sm text-[color:var(--color-ink-soft)] hover:text-[color:var(--color-ink)] transition-colors"
        >
          <span className={'inline-block transition-transform ' + (open ? 'rotate-90' : '')}>›</span>
          <span className="uppercase tracking-wide text-xs">Your library map</span>
          {total !== null && <span className="text-xs opacity-70">({total} saved)</span>}
        </button>
      )}

      {open && (
        <div className={embedded ? '' : 'mt-3'}>
          {state === 'loading' && (
            <p className="text-sm text-center text-[color:var(--color-ink-soft)] py-10">Mapping your knowledge…</p>
          )}
          {state === 'error' && (
            <p className="text-sm text-center text-[color:var(--color-ember)] py-10">
              Couldn’t load the map.{' '}
              <button onClick={load} className="underline underline-offset-2">Retry</button>
            </p>
          )}
          {state === 'idle' && data && total === 0 && (
            <p className="text-sm text-center text-[color:var(--color-ink-soft)] py-10">
              Nothing saved yet. Add a recipe or video above and it’ll appear here.
            </p>
          )}
          {state === 'idle' && data && total! > 0 && (
            <>
              <div className="glass overflow-hidden h-[420px]">
                <ForceGraph2D
                  ref={fgRef}
                  graphData={data}
                  backgroundColor="rgba(0,0,0,0)"
                  linkColor={(l: any) => (l.kind === 'shared' ? 'rgba(194,104,63,0.22)' : 'rgba(107,100,89,0.28)')}
                  linkWidth={1}
                  nodeRelSize={4}
                  cooldownTicks={120}
                  onNodeClick={(n: any) => { if (n.url) window.open(n.url, '_blank', 'noopener'); }}
                  nodeCanvasObject={(node: any, ctx: CanvasRenderingContext2D, scale: number) => {
                    const isSource = node.type === 'source';
                    const r = isSource ? 5 : 4;
                    ctx.beginPath();
                    ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
                    ctx.fillStyle = COLOR[node.type as NodeType] ?? COLOR.wisdom;
                    ctx.fill();
                    if (isSource) {
                      ctx.lineWidth = 1.5 / scale;
                      ctx.strokeStyle = ink;
                      ctx.stroke();
                    }
                    // Only label when zoomed in enough, to keep the overview calm.
                    if (scale > 1.4 || isSource) {
                      const fontSize = Math.max(8, 10 / scale);
                      ctx.font = `${fontSize}px ui-sans-serif, system-ui, sans-serif`;
                      ctx.fillStyle = ink;
                      ctx.textAlign = 'center';
                      ctx.textBaseline = 'top';
                      ctx.fillText(node.label, node.x, node.y + r + 1.5);
                    }
                  }}
                />
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-[color:var(--color-ink-soft)]">
                <Legend color={COLOR.source} label={`Sources ${data.counts.source}`} ring />
                <Legend color={COLOR.recipe} label={`Recipes ${data.counts.recipe}`} />
                <Legend color={COLOR.technique} label={`Techniques ${data.counts.technique}`} />
                <Legend color={COLOR.wisdom} label={`Wisdom ${data.counts.wisdom}`} />
                <button onClick={load} className="underline underline-offset-2 hover:text-[color:var(--color-ink)]">Refresh</button>
              </div>
              <p className="mt-1 text-center text-xs text-[color:var(--color-ink-soft)]/70">Tap a node to open its source.</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Legend({ color, label, ring }: { color: string; label: string; ring?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block w-2.5 h-2.5 rounded-full"
        style={{ background: color, boxShadow: ring ? 'inset 0 0 0 1px #2b2722' : undefined }}
      />
      {label}
    </span>
  );
}
