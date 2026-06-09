// Phase 3 — Dynamic Synthesis (RAG).
// Shapes the retrieved knowledge nodes into a prompt, and types the response
// the synthesis endpoint returns to the graph + guide UI.

export type NodeType = 'recipe' | 'technique' | 'wisdom';
export type SynthesisMode = 'synthesis' | 'pantry';

// One row back from match_knowledge / match_pantry.
export interface RetrievedNode {
  id: string;
  node_type: NodeType;
  title: string | null;     // null for wisdom
  body: string;
  source_url: string | null;
  metadata: { ingredients?: string[]; equipment?: string[] } | null;
  similarity: number;
}

// What /api/synthesize returns. `nodes` drives the force graph; `guide` is the
// Markdown the LLM wove from them.
export interface SynthesisResponse {
  prompt: string;
  mode: SynthesisMode;
  guide: string;
  nodes: RetrievedNode[];
}

const SYNTHESIS_SYSTEM = `You are Sift's synthesis engine. You weave a cook's
own saved knowledge into one cohesive, practical guide — never generic web
advice. Rules:
- Use ONLY the supplied nodes. If they don't cover something, say so plainly
  rather than inventing steps.
- Write in Markdown: a short title, then ordered steps, then a brief notes
  section for the relevant techniques and wisdom.
- Cite sources inline as [n] matching the numbered nodes, and end with a
  "Sources" list of the URLs you used. Omit nodes with no URL from that list.
- Be concise and exact. No preamble, no filler.`;

// Pantry Rescue tilts the instruction toward the daily constraint.
const PANTRY_NUDGE = `The cook wants something they can make right now from what
they have on hand. Favour the fastest viable path and flag any missing
essential ingredient.`;

// Assemble the numbered context block + the user's ask into a single prompt.
export function buildSynthesisPrompt(
  prompt: string,
  mode: SynthesisMode,
  nodes: RetrievedNode[],
): { system: string; user: string } {
  const numbered = nodes
    .map((n, i) => {
      const head = n.node_type === 'wisdom' ? 'WISDOM' : (n.title ?? n.node_type).toUpperCase();
      const src = n.source_url ? `\n   source: ${n.source_url}` : '';
      return `[${i + 1}] (${n.node_type}) ${head}${src}\n   ${n.body.replace(/\n+/g, ' ').trim()}`;
    })
    .join('\n\n');

  const user =
    `REQUEST: ${prompt}\n\n` +
    (mode === 'pantry' ? `${PANTRY_NUDGE}\n\n` : '') +
    `SAVED KNOWLEDGE (your only source material):\n\n${numbered}`;

  return { system: SYNTHESIS_SYSTEM, user };
}

// Extract every distinct ingredient noun from a free-text pantry list:
// "chicken, day-old rice and a lemon" -> ["chicken","day-old rice","a lemon"].
// Splits on commas / "and"; the DB does a metadata overlap (?|) on these.
export function parsePantryList(text: string): string[] {
  return text
    .split(/,|\band\b/i)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}
