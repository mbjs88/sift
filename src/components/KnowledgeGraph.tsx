// The semantic knowledge graph (spec §5 Phase 3, step 3): when a synthesis runs,
// the relevant nodes are "physically pulled together" around the prompt.
//
// react-force-graph-2d touches `window` and canvas, so this island must be
// mounted client:only — never server-rendered.

import { useMemo, useRef, useEffect } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import type { RetrievedNode, NodeType } from '../lib/synthesis';

interface GraphNode {
  id: string;
  label: string;
  type: NodeType | 'prompt';
  val: number;          // node size weight
}
interface GraphLink { source: string; target: string; }

const COLOR: Record<GraphNode['type'], string> = {
  prompt: '#2b2722',     // ink — the anchor
  recipe: '#b07d56',     // warm terracotta
  technique: '#7d8b6a',  // sage
  wisdom: '#c2a878',     // wheat
};

function shortLabel(n: RetrievedNode): string {
  if (n.title) return n.title;
  const first = n.body.replace(/\s+/g, ' ').trim().slice(0, 40);
  return first.length < n.body.length ? `${first}…` : first;
}

export default function KnowledgeGraph({ nodes }: { nodes: RetrievedNode[] }) {
  const fgRef = useRef<any>(null);

  const data = useMemo(() => {
    const gNodes: GraphNode[] = [
      { id: '__prompt__', label: 'Your request', type: 'prompt', val: 6 },
      ...nodes.map((n) => ({
        id: n.id,
        label: shortLabel(n),
        type: n.node_type,
        // Stronger matches sit larger and (via the force) closer to centre.
        val: 1 + Math.max(0, n.similarity) * 5,
      })),
    ];
    const gLinks: GraphLink[] = nodes.map((n) => ({ source: '__prompt__', target: n.id }));
    return { nodes: gNodes, links: gLinks };
  }, [nodes]);

  // Gentle settle, then stop — calm, not jittery.
  useEffect(() => {
    const fg = fgRef.current;
    if (fg) fg.d3VelocityDecay?.(0.4);
  }, [data]);

  if (nodes.length === 0) return null;

  return (
    <div className="rounded-3xl border border-[color:var(--color-stone-warm)] bg-[color:var(--color-flour)]/60 overflow-hidden h-[360px]">
      <ForceGraph2D
        ref={fgRef}
        graphData={data}
        backgroundColor="rgba(0,0,0,0)"
        linkColor={() => 'rgba(107,100,89,0.25)'}
        linkWidth={1}
        nodeRelSize={4}
        cooldownTicks={80}
        enableNodeDrag={false}
        nodeCanvasObject={(node: any, ctx: CanvasRenderingContext2D, scale: number) => {
          const r = Math.max(3, (node.val ?? 2) * 1.6);
          ctx.beginPath();
          ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
          ctx.fillStyle = COLOR[node.type as GraphNode['type']] ?? COLOR.wisdom;
          ctx.fill();

          const fontSize = Math.max(9, 11 / scale);
          ctx.font = `${fontSize}px ui-sans-serif, system-ui, sans-serif`;
          ctx.fillStyle = '#2b2722';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillText(node.label, node.x, node.y + r + 2);
        }}
      />
    </div>
  );
}
