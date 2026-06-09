// The whole-library graph: every saved node (recipe / technique / wisdom) for
// the caller's account, plus the edges that make it a network rather than a
// list. Read under the caller's RLS (anon key + their JWT) — no service role.
//
// Edges are computed here so the client just renders:
//   • each item links to a "source" hub (the page it came from) → clusters
//   • items from DIFFERENT sources that share an ingredient/equipment tag get a
//     light cross-link → the actual web between your saves
//
// GET /api/graph  (Authorization: Bearer <token>, or the sb-access-token cookie)

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { userClient, bearerFromRequest, resolveActiveAccount } from '../../lib/supabaseUser';

export const prerender = false;

type NodeType = 'recipe' | 'technique' | 'wisdom' | 'source';

interface GNode {
  id: string;
  type: NodeType;
  label: string;
  url?: string | null;
}
interface GLink { source: string; target: string; kind: 'source' | 'shared'; }

interface Row {
  id: string;
  title?: string | null;
  name?: string | null;
  body: string;
  source_url: string | null;
  metadata: { ingredients?: string[]; equipment?: string[] } | null;
}

export const GET: APIRoute = async ({ request }) => {
  const token = bearerFromRequest(request);
  if (!token) return json({ error: 'unauthenticated' }, 401);
  const supa = userClient(env, token);
  const { data: userData, error: userErr } = await supa.auth.getUser(token);
  if (userErr || !userData?.user) return json({ error: 'unauthenticated' }, 401);

  const accountId = await resolveActiveAccount(supa);
  if (!accountId) return json({ error: 'no_account' }, 409);

  const cols = 'id, body, source_url, metadata';
  const [recipes, techniques, wisdom] = await Promise.all([
    supa.from('recipes').select(`title, ${cols}`).eq('account_id', accountId),
    supa.from('techniques').select(`name, ${cols}`).eq('account_id', accountId),
    supa.from('wisdom').select(cols).eq('account_id', accountId),
  ]);

  const err = recipes.error || techniques.error || wisdom.error;
  if (err) return json({ error: 'read_failed', message: err.message }, 500);

  const nodes: GNode[] = [];
  const links: GLink[] = [];
  const sourceIds = new Map<string, string>();   // url -> hub node id
  const tagMembers = new Map<string, string[]>(); // tag -> item node ids

  function addSourceHub(url: string | null): string | null {
    if (!url) return null;
    let id = sourceIds.get(url);
    if (!id) {
      id = `src:${url}`;
      sourceIds.set(url, id);
      nodes.push({ id, type: 'source', label: hostOf(url), url });
    }
    return id;
  }

  function addItem(type: NodeType, row: Row, label: string) {
    const id = `${type}:${row.id}`;
    nodes.push({ id, type, label, url: row.source_url });

    const hub = addSourceHub(row.source_url);
    if (hub) links.push({ source: id, target: hub, kind: 'source' });

    const tags = [
      ...(row.metadata?.ingredients ?? []),
      ...(row.metadata?.equipment ?? []),
    ].map((t) => String(t).toLowerCase().trim()).filter(Boolean);
    for (const tag of new Set(tags)) {
      const list = tagMembers.get(tag) ?? [];
      list.push(id);
      tagMembers.set(tag, list);
    }
  }

  for (const r of (recipes.data ?? []) as Row[]) addItem('recipe', r, r.title || 'Recipe');
  for (const t of (techniques.data ?? []) as Row[]) addItem('technique', t, t.name || 'Technique');
  for (const w of (wisdom.data ?? []) as Row[]) addItem('wisdom', w, snippet(w.body));

  // Cross-links: for each shared tag, chain its members together (O(n) edges,
  // not O(n²)) so common ingredients weave the clusters without a hairball.
  const seen = new Set<string>();
  for (const members of tagMembers.values()) {
    if (members.length < 2) continue;
    for (let i = 1; i < members.length; i++) {
      const a = members[i - 1], b = members[i];
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ source: a, target: b, kind: 'shared' });
    }
  }

  return json({ nodes, links, counts: counts(nodes) }, 200);
};

function counts(nodes: GNode[]) {
  const c = { recipe: 0, technique: 0, wisdom: 0, source: 0 };
  for (const n of nodes) c[n.type]++;
  return c;
}

function snippet(body: string): string {
  const s = body.replace(/\s+/g, ' ').trim();
  return s.length > 38 ? s.slice(0, 38) + '…' : s;
}
function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
