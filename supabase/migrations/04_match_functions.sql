-- Sift — RLS-aware RAG retrieval
--
-- THE TENANT-ISOLATION HARD GATE.
-- A vector search that bypasses RLS is the single worst failure mode for this
-- product: the LLM would synthesise one tenant's guide from another tenant's
-- private wisdom. Three independent defences are stacked here:
--
--   1. SECURITY INVOKER (the default) — the function runs with the CALLER's
--      privileges, so the RLS policies on recipes/techniques/wisdom apply to
--      every row it touches. A SECURITY DEFINER function would silently defeat
--      this; we deliberately do NOT use it.
--   2. Explicit  account_id = p_account_id  predicate — scopes the search to
--      the one active account even when the user belongs to several.
--   3. is_account_member(p_account_id) guard — rejects the whole call if the
--      caller is not a member of the requested account.
--
-- Unified across the three node types so RAG pulls Recipes, Techniques and
-- Wisdom together in one round trip, ranked by cosine similarity.

create or replace function public.match_knowledge(
  query_embedding vector(768),
  p_account_id    uuid,
  match_count     int default 12,
  similarity_threshold float default 0.0
)
returns table (
  id          uuid,
  node_type   text,
  title       text,
  body        text,
  source_url  text,
  metadata    jsonb,
  similarity  float
)
language sql
stable
security invoker            -- RLS of the caller is enforced. Do not change.
set search_path = public, pg_temp
as $$
  with guard as (
    -- Hard stop: non-members get an empty result, never an error leak.
    select public.is_account_member(p_account_id) as ok
  ),
  hits as (
    select r.id, 'recipe'::text as node_type, r.title, r.body, r.source_url,
           r.metadata, 1 - (r.embedding <=> query_embedding) as similarity
    from public.recipes r, guard
    where guard.ok
      and r.account_id = p_account_id
      and r.embedding is not null

    union all
    select t.id, 'technique', t.name, t.body, t.source_url,
           t.metadata, 1 - (t.embedding <=> query_embedding)
    from public.techniques t, guard
    where guard.ok
      and t.account_id = p_account_id
      and t.embedding is not null

    union all
    select w.id, 'wisdom', null, w.body, w.source_url,
           w.metadata, 1 - (w.embedding <=> query_embedding)
    from public.wisdom w, guard
    where guard.ok
      and w.account_id = p_account_id
      and w.embedding is not null
  )
  select id, node_type, title, body, source_url, metadata, similarity
  from hits
  where similarity >= similarity_threshold
  order by similarity desc
  limit match_count;
$$;

-- Pantry Rescue: same isolation guarantees, but pre-filtered to rows whose
-- metadata.ingredients overlap the on-hand list before semantic ranking.
create or replace function public.match_pantry(
  query_embedding vector(768),
  p_account_id    uuid,
  on_hand         text[],
  match_count     int default 12
)
returns table (
  id uuid, node_type text, title text, body text,
  source_url text, metadata jsonb, similarity float
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with guard as (select public.is_account_member(p_account_id) as ok),
  hits as (
    select r.id, 'recipe'::text, r.title, r.body, r.source_url, r.metadata,
           1 - (r.embedding <=> query_embedding) as similarity
    from public.recipes r, guard
    where guard.ok and r.account_id = p_account_id and r.embedding is not null
      and (r.metadata->'ingredients') ?| on_hand
    union all
    select t.id, 'technique', t.name, t.body, t.source_url, t.metadata,
           1 - (t.embedding <=> query_embedding)
    from public.techniques t, guard
    where guard.ok and t.account_id = p_account_id and t.embedding is not null
      and (t.metadata->'ingredients') ?| on_hand
  )
  select * from hits order by similarity desc limit match_count;
$$;
