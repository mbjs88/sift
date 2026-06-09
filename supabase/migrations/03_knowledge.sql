-- Sift — knowledge tables (the proprietary moat)
-- Recipe / Technique / Wisdom, each tied to an account_id, each carrying a
-- vector embedding and a metadata JSONB array for DaaS / affiliate routing.
--
-- Embedding dimension = 768. Gemini gemini-embedding-001 emits 3072 dims by
-- default, but pgvector's HNSW/IVFFlat indexes cap at 2000 dims. We therefore
-- request output_dimensionality=768 at embed time (in llmRouter) so the column
-- stays indexable. Keep this number in lockstep with the router config.

-- ---------------------------------------------------------------------------
-- Ingestion jobs — lifecycle of a shared URL through the queue
-- ---------------------------------------------------------------------------
create table if not exists public.ingestion_jobs (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  url         text not null,
  status      text not null default 'queued'
              check (status in ('queued','scraping','extracting','done','failed')),
  error       text,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists ingestion_jobs_account_idx on public.ingestion_jobs (account_id);

-- ---------------------------------------------------------------------------
-- Recipes
-- ---------------------------------------------------------------------------
create table if not exists public.recipes (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  title       text not null,
  source_url  text,
  body        text not null,            -- distilled recipe (the "signal")
  embedding   vector(768),
  metadata    jsonb not null default '{}'::jsonb,  -- {ingredients:[], equipment:[]}
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Techniques (e.g. BBQ temp control, sourdough hydration)
-- ---------------------------------------------------------------------------
create table if not exists public.techniques (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  name        text not null,
  source_url  text,
  body        text not null,
  embedding   vector(768),
  metadata    jsonb not null default '{}'::jsonb,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Wisdom (universal, cross-pollinated culinary principles)
-- ---------------------------------------------------------------------------
create table if not exists public.wisdom (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  source_url  text,
  body        text not null,
  embedding   vector(768),
  metadata    jsonb not null default '{}'::jsonb,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- account_id btree: cheap pre-filter so RLS-scoped queries stay fast.
-- HNSW (cosine): approximate nearest-neighbour for RAG retrieval.
-- GIN on metadata: Pantry Rescue / DaaS lookups by ingredient or equipment.
-- ---------------------------------------------------------------------------
create index if not exists recipes_account_idx     on public.recipes    (account_id);
create index if not exists techniques_account_idx  on public.techniques (account_id);
create index if not exists wisdom_account_idx      on public.wisdom     (account_id);

create index if not exists recipes_embedding_idx
  on public.recipes using hnsw (embedding vector_cosine_ops);
create index if not exists techniques_embedding_idx
  on public.techniques using hnsw (embedding vector_cosine_ops);
create index if not exists wisdom_embedding_idx
  on public.wisdom using hnsw (embedding vector_cosine_ops);

create index if not exists recipes_metadata_idx    on public.recipes    using gin (metadata);
create index if not exists techniques_metadata_idx on public.techniques using gin (metadata);
create index if not exists wisdom_metadata_idx      on public.wisdom     using gin (metadata);

-- ---------------------------------------------------------------------------
-- RLS — every knowledge table is gated on account membership.
-- Reads: rows of accounts the caller belongs to.
-- Writes: same, AND created_by must be the caller (no impersonation).
-- The queue consumer uses the service-role key, which bypasses RLS by design;
-- these policies govern the browser / SSR (anon key + user JWT) path only.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['recipes','techniques','wisdom','ingestion_jobs']
  loop
    execute format('alter table public.%I enable row level security;', t);

    execute format($f$
      drop policy if exists %1$s_select on public.%1$s;
      create policy %1$s_select on public.%1$s
        for select to authenticated
        using (account_id in (select public.auth_account_ids()));
    $f$, t);

    execute format($f$
      drop policy if exists %1$s_insert on public.%1$s;
      create policy %1$s_insert on public.%1$s
        for insert to authenticated
        with check (
          account_id in (select public.auth_account_ids())
          and (created_by is null or created_by = auth.uid())
        );
    $f$, t);

    execute format($f$
      drop policy if exists %1$s_update on public.%1$s;
      create policy %1$s_update on public.%1$s
        for update to authenticated
        using (account_id in (select public.auth_account_ids()))
        with check (account_id in (select public.auth_account_ids()));
    $f$, t);

    execute format($f$
      drop policy if exists %1$s_delete on public.%1$s;
      create policy %1$s_delete on public.%1$s
        for delete to authenticated
        using (account_id in (select public.auth_account_ids()));
    $f$, t);
  end loop;
end $$;
