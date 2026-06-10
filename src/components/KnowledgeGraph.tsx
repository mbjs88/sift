// The semantic knowledge graph (spec §5 Phase 3, step 3): when a synthesis runs,
// the relevant nodes are pulled together around the prompt. Rendered with our
// own ForceCanvas (no external force-graph dependency).

import { useEffect, useMemo, useState } from 'react';
import ForceCanvas, { type FLink, type FNode } from './ForceCanvas';
import type { RetrievedNode, NodeType } from '../lib/synthesis';

const COLOR: Record<NodeType, string> = {
  recipe: '#b07d56',     // warm terracotta
  technique: '#7d8b6a',  // sage
  wisdom: '#c2a878',     // wheat
};

function shortLabel(n: RetrievedNode): string {
  if (n.title) return n.title;
  const first = n.body.replace(/\s+/g, ' ').trim().slice(0, 40);
  return first.length < n.body.length ? `${first}…` : first;
}

function useInkColor(): string {
  const get = () => {
    if (typeof document !== 'undefined') {
      if (document.documentElement.classList.contains('theme-dark')) return '#f4ede2';
      if (document.documentElement.classList.contains('theme-light')) return '#2b2722';
    }
    return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? '#f4ede2' : '#2b2722';
  };
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

export default function KnowledgeGraph({ nodes }: { nodes: RetrievedNode[] }) {
  const ink = useInkColor();

  const fNodes: FNode[] = useMemo(() => [
    { id: '__prompt__', label: 'Your request', color: ink, r: 8, alwaysLabel: true },
    ...nodes.map((n) => ({
      id: n.id,
      label: shortLabel(n),
      color: COLOR[n.node_type] ?? COLOR.wisdom,
      // Stronger matches sit larger (and, via the spring force, closer in).
      r: 4 + Math.max(0, n.similarity) * 5,
      alwaysLabel: true,
    })),
  ], [nodes, ink]);

  const fLinks: FLink[] = useMemo(() =>
    nodes.map((n) => ({
      source: '__prompt__',
      target: n.id,
      color: 'rgba(150,140,128,0.30)',
      // Stronger matches pull in closer to the prompt.
      rest: 90 - Math.max(0, Math.min(1, n.similarity)) * 45,
    })), [nodes]);

  if (nodes.length === 0) return null;

  return (
    <div className="glass overflow-hidden h-[360px]">
      <ForceCanvas nodes={fNodes} links={fLinks} ink={ink} />
    </div>
  );
}
