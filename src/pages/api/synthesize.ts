// Phase 3 entry point — Dynamic Synthesis (RAG) + Pantry Rescue.
//
// Pipeline (spec §5 Phase 3):
//   1. Embed the prompt as a query vector.
//   2. Retrieve the top matching nodes via the RLS-scoped match function, so
//      the search can only ever see the caller's own account.
//   3. Hand those nodes to the LLM to weave a cited Markdown guide.
//   4. Return guide + nodes; the client pulls the nodes together on the graph.
//
// Embedding and generation use the app's GEMINI_API_KEY. Retrieval uses the
// user's JWT (anon key) — never the service-role key. Tenant isolation lives
// in the SQL function (SECURITY INVOKER); this endpoint just passes the token.

import type { APIRoute } from 'astro';
import { createRouter } from '../../lib/llmRouter';
import {
  userClient, bearerFromRequest, resolveActiveAccount,
} from '../../lib/supabaseUser';
import {
  buildSynthesisPrompt, parsePantryList,
  type SynthesisMode, type RetrievedNode, type SynthesisResponse,
} from '../../lib/synthesis';

export const prerender = false;

interface SynthInput {
  prompt: string;
  mode: SynthesisMode;
  onHand?: string;   // free-text pantry list, pantry mode only
}

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;

  const body = await request.json().catch(() => null) as Partial<SynthInput> | null;
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
  const mode: SynthesisMode = body?.mode === 'pantry' ? 'pantry' : 'synthesis';
  if (!prompt) return json({ error: 'empty_prompt' }, 400);

  const token = bearerFromRequest(request);
  if (!token) return json({ error: 'unauthenticated' }, 401);

  const supa = userClient(env, token);
  const { data: userData, error: userErr } = await supa.auth.getUser(token);
  if (userErr || !userData?.user) return json({ error: 'unauthenticated' }, 401);

  const accountId = await resolveActiveAccount(supa);
  if (!accountId) return json({ error: 'no_account' }, 409);

  const router = createRouter({
    apiKey: env.GEMINI_API_KEY,
    embeddingModel: env.EMBEDDING_MODEL,
    generationModel: env.GENERATION_MODEL,
  });

  // 1. Query embedding (RETRIEVAL_QUERY task type).
  const queryEmbedding = await router.embed(prompt, 'query');
  const vectorLiteral = `[${queryEmbedding.join(',')}]`;

  // 2. RLS-scoped retrieval. Pantry mode pre-filters on metadata.ingredients.
  let nodes: RetrievedNode[];
  if (mode === 'pantry') {
    const onHand = parsePantryList(body?.onHand ?? prompt);
    const { data, error } = await supa.rpc('match_pantry', {
      query_embedding: vectorLiteral,
      p_account_id: accountId,
      on_hand: onHand,
      match_count: 12,
    });
    if (error) return json({ error: 'retrieval_failed', message: error.message }, 500);
    nodes = (data ?? []) as RetrievedNode[];
  } else {
    const { data, error } = await supa.rpc('match_knowledge', {
      query_embedding: vectorLiteral,
      p_account_id: accountId,
      match_count: 12,
      similarity_threshold: 0.2,
    });
    if (error) return json({ error: 'retrieval_failed', message: error.message }, 500);
    nodes = (data ?? []) as RetrievedNode[];
  }

  // Nothing saved yet (or nothing relevant) — return early so the UI can prompt
  // the user to ingest, rather than letting the LLM hallucinate a guide.
  if (nodes.length === 0) {
    const empty: SynthesisResponse = {
      prompt, mode, nodes: [],
      guide: '_No saved knowledge matched this yet. Share a recipe or video to Sift, then try again._',
    };
    return json(empty, 200);
  }

  // 3. Synthesize a cited Markdown guide from the retrieved nodes only.
  const { system, user } = buildSynthesisPrompt(prompt, mode, nodes);
  const guide = await router.generate(system, user);

  const payload: SynthesisResponse = { prompt, mode, guide, nodes };
  return json(payload, 200);
};

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
