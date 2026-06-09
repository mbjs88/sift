# Sift — Database (Step 2)

Multi-tenant Postgres + pgvector schema. Data is never keyed to a user; every
knowledge row belongs to an `account`. This is what makes Family Brains and B2B
white-labelling possible without a re-architecture later.

## Apply

    supabase db execute --file supabase/migrations/01_extensions.sql
    supabase db execute --file supabase/migrations/02_accounts.sql
    supabase db execute --file supabase/migrations/03_knowledge.sql
    supabase db execute --file supabase/migrations/04_match_functions.sql

Then prove isolation (must pass before any data goes in):

    supabase db execute --file supabase/tests/tenant_isolation_test.sql

## Tenant isolation model

Three layers, designed so no single mistake leaks data across tenants.

1. **Membership, recursion-safe.** `auth_account_ids()`, `is_account_member()`
   and `is_account_admin()` are `SECURITY DEFINER` and scoped to `auth.uid()`.
   They read `account_members` without firing its RLS, which is what lets RLS
   policies call them without infinite recursion. Because they only ever return
   the *current* user's memberships, they cannot reveal another tenant.

2. **RLS on every table.** `accounts`, `account_members`, `recipes`,
   `techniques`, `wisdom`, `ingestion_jobs` all enable RLS. Knowledge reads are
   scoped to `account_id in (select auth_account_ids())`; writes additionally
   require `created_by = auth.uid()`. Account rows are created only through
   `create_account()`, which enrolls the creator as owner atomically.

3. **RLS-aware retrieval.** `match_knowledge()` and `match_pantry()` are
   `SECURITY INVOKER` — the RLS of the calling user applies to every row the
   vector search touches. A `SECURITY DEFINER` search function would silently
   bypass RLS and let the LLM synthesise across tenants; we deliberately avoid
   it. Two further guards stack on top: an explicit `account_id = p_account_id`
   predicate and an `is_account_member()` gate that empties the result for a
   non-member.

The queue consumer (Step 3) uses the **service-role key**, which bypasses RLS by
design, to write extracted rows. RLS governs only the browser / SSR path
(anon key + user JWT). Keep the service-role key out of anything client-facing.

## Embedding dimension: 768 (not 3072)

`gemini-embedding-001` defaults to 3072 dims, but pgvector's HNSW index caps at
2000. The columns are `vector(768)`, so `llmRouter` must request
`output_dimensionality: 768` at embed time. These two numbers must move together.

## Validation status

Statically verified (21 checks: dollar-quote balance, dimension consistency,
RLS + policy coverage, INVOKER/DEFINER modes, recursion guard, search_path
pinning). Not yet executed against a live database — run the isolation test on
your Supabase project to confirm end-to-end before loading real data.

## Files

| File | Purpose |
|------|---------|
| `migrations/01_extensions.sql` | `vector`, `pgcrypto` |
| `migrations/02_accounts.sql` | accounts, members, helpers, `create_account()`, RLS |
| `migrations/03_knowledge.sql` | recipes/techniques/wisdom/jobs, HNSW + GIN indexes, RLS |
| `migrations/04_match_functions.sql` | `match_knowledge()`, `match_pantry()` — RLS-aware RAG |
| `tests/tenant_isolation_test.sql` | cross-tenant leak test (the hard gate) |
