// ForceCanvas — a small, dependency-free force-directed graph on <canvas>.
// Replaces react-force-graph-2d, which sized its canvas to the window and
// broke inside clipped containers. This one fills whatever box it's given.
//
// Interactions: drag to pan, wheel / pinch to zoom, tap a node, double-tap to
// re-fit. The camera auto-fits the simulation until the user takes over.

import { useEffect, useMemo, useRef } from 'react';

export interface FNode {
  id: string;
  label: string;
  color: string;
  r: number;
  ring?: string | null;     // stroke colour for hub nodes
  url?: string | null;
  alwaysLabel?: boolean;    // label regardless of zoom level
}
export interface FLink { source: string; target: string; color: string; rest?: number; }

interface SimNode extends FNode { x: number; y: number; vx: number; vy: number; }

export default function ForceCanvas({ nodes, links, ink, labelThreshold = 1.3, onNodeClick }: {
  nodes: FNode[];
  links: FLink[];
  ink: string;
  labelThreshold?: number;
  onNodeClick?: (n: FNode) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inkRef = useRef(ink);
  inkRef.current = ink;
  const clickRef = useRef(onNodeClick);
  clickRef.current = onNodeClick;

  // Stable identity so a parent re-render doesn't rebuild the simulation.
  const graph = useMemo(() => ({ nodes, links }), [nodes, links]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const maybeCtx = canvas.getContext('2d');
    if (!maybeCtx) return;
    const ctx: CanvasRenderingContext2D = maybeCtx;

    // ----- simulation state ---------------------------------------------
    const sim: SimNode[] = graph.nodes.map((n, i) => {
      const a = i * 2.399963; // golden-angle spiral start
      const rad = 30 + 13 * Math.sqrt(i);
      return { ...n, x: Math.cos(a) * rad, y: Math.sin(a) * rad, vx: 0, vy: 0 };
    });
    const byId = new Map(sim.map((n) => [n.id, n]));
    const spr = graph.links
      .map((l) => ({ a: byId.get(l.source), b: byId.get(l.target), color: l.color, rest: l.rest ?? 42 }))
      .filter((l): l is { a: SimNode; b: SimNode; color: string; rest: number } => !!l.a && !!l.b);

    let alpha = 1;
    let interacted = false;
    let dirty = true;
    let w = 0, h = 0, dpr = 1;
    const cam = { s: 1, tx: 0, ty: 0 };

    // ----- camera ---------------------------------------------------------
    function fit() {
      if (sim.length === 0 || w === 0 || h === 0) return;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const n of sim) {
        if (n.x < minX) minX = n.x; if (n.x > maxX) maxX = n.x;
        if (n.y < minY) minY = n.y; if (n.y > maxY) maxY = n.y;
      }
      const bw = Math.max(maxX - minX, 40), bh = Math.max(maxY - minY, 40);
      cam.s = Math.min(Math.min(w / bw, h / bh) * 0.78, 2.2);
      cam.tx = w / 2 - cam.s * (minX + maxX) / 2;
      cam.ty = h / 2 - cam.s * (minY + maxY) / 2;
      dirty = true;
    }

    function zoomAt(sx: number, sy: number, f: number) {
      const ns = Math.min(6, Math.max(0.12, cam.s * f));
      const k = ns / cam.s;
      cam.tx = sx - k * (sx - cam.tx);
      cam.ty = sy - k * (sy - cam.ty);
      cam.s = ns;
      dirty = true;
    }

    // ----- sizing ----------------------------------------------------------
    const ro = new ResizeObserver(() => {
      dpr = window.devicePixelRatio || 1;
      w = canvas.clientWidth; h = canvas.clientHeight;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      if (!interacted) fit();
      dirty = true;
    });
    ro.observe(canvas);

    // ----- physics ----------------------------------------------------------
    function tick(): boolean {
      if (alpha < 0.02) return false;
      const n = sim.length;
      // pairwise repulsion (fine for a few hundred nodes)
      for (let i = 0; i < n; i++) {
        const a = sim[i];
        for (let j = i + 1; j < n; j++) {
          const b = sim[j];
          let dx = a.x - b.x, dy = a.y - b.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 1) { dx = (Math.random() - 0.5); dy = (Math.random() - 0.5); d2 = 1; }
          const f = (820 * alpha) / d2;
          const d = Math.sqrt(d2);
          const fx = (dx / d) * f, fy = (dy / d) * f;
          a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
        }
      }
      // springs
      for (const l of spr) {
        const dx = l.b.x - l.a.x, dy = l.b.y - l.a.y;
        const d = Math.max(Math.sqrt(dx * dx + dy * dy), 0.01);
        const f = (d - l.rest) * 0.025 * alpha;
        const fx = (dx / d) * f, fy = (dy / d) * f;
        l.a.vx += fx; l.a.vy += fy; l.b.vx -= fx; l.b.vy -= fy;
      }
      // gentle gravity to the origin + integration
      for (const nd of sim) {
        nd.vx -= nd.x * 0.004 * alpha;
        nd.vy -= nd.y * 0.004 * alpha;
        nd.vx *= 0.82; nd.vy *= 0.82;
        nd.x += nd.vx; nd.y += nd.vy;
      }
      alpha *= 0.988;
      return true;
    }

    // ----- drawing -----------------------------------------------------------
    function draw() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.setTransform(dpr * cam.s, 0, 0, dpr * cam.s, dpr * cam.tx, dpr * cam.ty);
      ctx.lineWidth = 1 / cam.s;
      for (const l of spr) {
        ctx.beginPath();
        ctx.moveTo(l.a.x, l.a.y);
        ctx.lineTo(l.b.x, l.b.y);
        ctx.strokeStyle = l.color;
        ctx.stroke();
      }
      const showLabels = cam.s > labelThreshold;
      const fontSize = Math.max(9 / cam.s, Math.min(12 / cam.s, 12));
      ctx.font = `${fontSize}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      for (const nd of sim) {
        ctx.beginPath();
        ctx.arc(nd.x, nd.y, nd.r, 0, 2 * Math.PI);
        ctx.fillStyle = nd.color;
        ctx.fill();
        if (nd.ring) {
          ctx.lineWidth = 1.5 / cam.s;
          ctx.strokeStyle = nd.ring;
          ctx.stroke();
          ctx.lineWidth = 1 / cam.s;
        }
        if (nd.alwaysLabel || showLabels) {
          ctx.fillStyle = inkRef.current;
          ctx.fillText(nd.label, nd.x, nd.y + nd.r + 2 / cam.s);
        }
      }
    }

    let rafId = 0;
    const loop = () => {
      const active = tick();
      if (active && !interacted) fit();
      if (active || dirty) { draw(); dirty = false; }
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);

    // ----- interaction ---------------------------------------------------------
    const pointers = new Map<number, { x: number; y: number }>();
    let moved = 0;
    let pinchD = 0;

    function hitTest(sx: number, sy: number): SimNode | null {
      const wx = (sx - cam.tx) / cam.s, wy = (sy - cam.ty) / cam.s;
      const slack = 9 / cam.s;
      let best: SimNode | null = null, bestD = Infinity;
      for (const nd of sim) {
        const dx = nd.x - wx, dy = nd.y - wy;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < Math.max(nd.r, slack) && d < bestD) { best = nd; bestD = d; }
      }
      return best;
    }

    const onDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (pointers.size === 1) moved = 0;
      if (pointers.size === 2) {
        const [p1, p2] = [...pointers.values()];
        pinchD = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      }
    };
    const onMove = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      const cur = { x: e.offsetX, y: e.offsetY };
      pointers.set(e.pointerId, cur);
      if (pointers.size === 1) {
        const dx = cur.x - prev.x, dy = cur.y - prev.y;
        moved += Math.abs(dx) + Math.abs(dy);
        if (moved > 4) {
          cam.tx += dx; cam.ty += dy;
          interacted = true; dirty = true;
        }
      } else if (pointers.size === 2) {
        const [p1, p2] = [...pointers.values()];
        const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        if (pinchD > 0) zoomAt((p1.x + p2.x) / 2, (p1.y + p2.y) / 2, d / pinchD);
        pinchD = d;
        interacted = true;
      }
    };
    const onUp = (e: PointerEvent) => {
      const had = pointers.has(e.pointerId);
      pointers.delete(e.pointerId);
      pinchD = 0;
      if (had && pointers.size === 0 && moved <= 4) {
        const hit = hitTest(e.offsetX, e.offsetY);
        if (hit) clickRef.current?.(hit);
      }
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * 0.0016));
      interacted = true;
    };
    const onDbl = () => { interacted = false; fit(); };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('dblclick', onDbl);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('dblclick', onDbl);
    };
  }, [graph, labelThreshold]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none', cursor: 'grab' }}
    />
  );
}
