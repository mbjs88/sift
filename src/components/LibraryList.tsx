// A browsable list of everything saved — grouped by kind, tap to open the
// source. Reuses /api/graph (which already returns every node + counts), so no
// new endpoint. client:only.

import { useEffect, useState } from 'react';

function sessionToken(): string | null {
  const m = document.cookie.match(/(?:^|;\s*)sb-access-token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

type NodeType = 'recipe' | 'technique' | 'wisdom' | 'source';
interface GNode { id: string; type: NodeType; label: string; url?: string | null; }
interface GraphData { nodes: GNode[]; counts: Record<NodeType, number>; }

const COLOR: Record<NodeType, string> = {
  recipe: 'var(--n-recipe)', technique: 'var(--n-technique)', wisdom: 'var(--n-wisdom)', source: 'var(--n-source)',
};
const GROUPS: { type: NodeType; label: string }[] = [
  { type: 'recipe', label: 'Recipes' },
  { type: 'technique', label: 'Techniques' },
  { type: 'wisdom', label: 'Wisdom' },
];

export default function LibraryList() {
  const [data, setData] = useState<GraphData | null>(null);
  const [state, setState] = useState<'loading' | 'idle' | 'error'>('loading');
  const [filter, setFilter] = useState<NodeType | 'all'>('all');

  useEffect(() => { void load(); }, []);
  async function load() {
    const token = sessionToken();
    if (!token) { setState('error'); return; }
    setState('loading');
    try {
      const res = await fetch('/api/graph', { headers: { authorization: `Bearer ${token}` } });
      if (!res.ok) { setState('error'); return; }
      setData((await res.json()) as GraphData);
      setState('idle');
    } catch { setState('error'); }
  }

  if (state === 'loading') {
    return (
      <div className="flex flex-col gap-2">
        {[0, 1, 2, 3, 4].map((i) => <div key={i} className="skel" style={{ height: 52 }} />)}
      </div>
    );
  }
  if (state === 'error') {
    return <p className="muted text-center" style={{ padding: '40px 0' }}>Couldn’t load your library. <button className="action" style={{ padding: '4px 12px' }} onClick={load}>Retry</button></p>;
  }

  const total = data ? data.nodes.filter((n) => n.type !== 'source').length : 0;
  if (total === 0) {
    return (
      <div className="glass rise" style={{ padding: '44px 24px', textAlign: 'center' }}>
        <p className="muted" style={{ margin: 0 }}>Nothing saved yet. Add a recipe from the Home tab and it’ll appear here.</p>
      </div>
    );
  }

  const shown = data!.nodes.filter((n) => n.type !== 'source' && (filter === 'all' || n.type === filter));

  return (
    <div className="flex flex-col gap-4">
      {/* filter chips */}
      <div className="flex gap-2 flex-wrap">
        <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>All {total}</FilterChip>
        {GROUPS.map((g) => (
          <FilterChip key={g.type} active={filter === g.type} onClick={() => setFilter(g.type)} color={COLOR[g.type]}>
            {g.label} {data!.counts[g.type] ?? 0}
          </FilterChip>
        ))}
      </div>

      <ul className="glass flex flex-col" style={{ padding: 6, gap: 2 }}>
        {shown.map((n) => (
          <li key={n.id}>
            <button
              onClick={() => { if (n.url) window.open(n.url, '_blank', 'noopener'); }}
              disabled={!n.url}
              className="w-full flex items-center gap-3 text-left rounded-xl px-3 py-2.5 transition-colors"
              style={{ background: 'transparent' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgb(var(--glass-edge) / 0.05)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <span style={{ width: 9, height: 9, borderRadius: '50%', flex: 'none', background: COLOR[n.type] }} />
              <span className="flex-1 min-w-0 truncate" style={{ fontSize: '0.92rem', color: 'var(--color-ink)' }}>{n.label}</span>
              <span className="eyebrow" style={{ fontSize: '0.62rem' }}>{n.type}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FilterChip({ active, onClick, color, children }: { active: boolean; onClick: () => void; color?: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="chip"
      style={active ? { background: 'var(--ember-soft)', color: 'var(--ember-ink)', borderColor: 'transparent' } : undefined}
    >
      {color && <span style={{ width: 7, height: 7, borderRadius: '50%', background: color }} />}
      {children}
    </button>
  );
}
