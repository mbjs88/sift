// The semantic knowledge graph (spec §5 Phase 3, step 3): when a synthesis runs,
// the relevant nodes are "physically pulled together" around the prompt.
//
// react-force-graph-2d touches `window` and canvas, so this island must be
// mounted client:only — never server-rendered.

import { useMemo, useRef, useEffect, useState } from 'react';
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

// ForceGraph2D defaults its canvas to the WINDOW size; inside a fixed-height,
// overflow-hidden card the graph then sits outside the visible crop. Measure
// the container and pass explicit dimensions.
function useBoxSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, size };
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
  const fgRef = useRef<any>(null);
  const ink = useInkColor();
  const { ref: boxRef, size } = useBoxSize();

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
    <div ref={boxRef} className="glass overflow-hidden h-[360px]">
      {size.w > 0 && <ForceGraph2D
        ref={fgRef}
        width={size.w}
        height={size.h}
        graphData={data}
        backgroundColor="rgba(0,0,0,0)"
        linkColor={() => 'rgba(150,140,128,0.30)'}
        linkWidth={1}
        nodeRelSize={4}
        cooldownTicks={80}
        onEngineStop={() => fgRef.current?.zoomToFit(400, 24)}
        enableNodeDrag={false}
        nodeCanvasObject={(node: any, ctx: CanvasRenderingContext2D, scale: number) => {
          const r = Math.max(3, (node.val ?? 2) * 1.6);
          ctx.beginPath();
          ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
          const fill = node.type === 'prompt' ? ink : (COLOR[node.type as GraphNode['type']] ?? COLOR.wisdom);
          ctx.fillStyle = fill;
          ctx.fill();

          const fontSize = Math.max(9, 11 / scale);
          ctx.font = `${fontSize}px ui-sans-serif, system-ui, sans-serif`;
          ctx.fillStyle = ink;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillText(node.label, node.x, node.y + r + 2);
        }}
      />}
    </div>
  );
}
