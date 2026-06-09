-- Sift — Tenant Isolation Test (THE HARD GATE)
-- Apply migrations 01-04 first, then run this whole file in the Supabase SQL
-- editor (or: psql -f / supabase db execute --file). No psql meta-commands are
-- used, so it runs anywhere.
--
-- Design note (why this shape): the editor connects as a BYPASSRLS superuser.
-- ALL setup is therefore done up front, as that superuser, using FIXED account
-- ids — no helper table, and no create_account() (which needs auth.uid()). The
-- role is switched to `authenticated` ONLY for the read-only assertions, and
-- those touch nothing but the permanent migration tables (techniques,
-- match_knowledge). Earlier versions carried ids in a temp/helper table and
-- referenced it after SET ROLE; the editor doesn't keep that object visible
-- across the role switch, which is what produced the "relation ... does not
-- exist" error. Nothing created here is referenced after a role switch.
--
-- The assertions SET LOCAL ROLE authenticated and set the JWT 'sub' claim that
-- auth.uid() reads — otherwise RLS would be silently skipped and the test would
-- prove nothing. Clean run = isolation holds. Any leak raises an exception.
-- Everything is rolled back at the end; no test data persists.

begin;

-- --- Setup as the superuser (RLS bypassed) ---------------------------------
-- Two real auth users.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@test.dev'),
  ('22222222-2222-2222-2222-222222222222', 'bob@test.dev')
on conflict (id) do nothing;

-- Two accounts with fixed ids (A = Alice, B = Bob) and their owner memberships.
insert into public.accounts (id, name, account_type) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Alice Brain', 'personal'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Bob Brain',   'personal');

insert into public.account_members (account_id, user_id, role) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '11111111-1111-1111-1111-111111111111', 'owner'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   '22222222-2222-2222-2222-222222222222', 'owner');

-- One private technique owned by Alice's account. The embedding is a constant
-- 0.1 vector so a matching query gives cosine similarity = 1.
insert into public.techniques (account_id, name, body, embedding, created_by, metadata)
values (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'Alice secret sear',
  'Reverse sear at 120C then blast to 260C.',
  ('[' || array_to_string(array_fill(0.1::real, array[768]), ',') || ']')::vector,
  '11111111-1111-1111-1111-111111111111',
  '{"ingredients":["beef shin"],"equipment":["dutch oven"]}'
);

-- --- Assert 1 & 2: Bob can read NONE of Alice's data ------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

-- Assert 1: Bob's RLS-scoped SELECT sees none of Alice's rows.
do $$
declare n int;
begin
  select count(*) into n from public.techniques;
  if n <> 0 then
    raise exception 'LEAK: Bob sees % technique row(s) via direct SELECT (expected 0)', n;
  end if;
  raise notice 'PASS 1: direct SELECT returns 0 rows for non-member';
end $$;

-- Assert 2: even handed Alice's account_id, the RAG function returns nothing.
do $$
declare n int;
  qe vector(768) := ('[' || array_to_string(array_fill(0.1::real, array[768]), ',') || ']')::vector;
begin
  select count(*) into n
  from public.match_knowledge(qe, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 50, 0.0);
  if n <> 0 then
    raise exception 'LEAK: match_knowledge gave Bob % of Alice''s row(s) (expected 0)', n;
  end if;
  raise notice 'PASS 2: match_knowledge returns 0 rows for non-member account';
end $$;

-- --- Positive control: Alice CAN retrieve her own data ----------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare n int;
  qe vector(768) := ('[' || array_to_string(array_fill(0.1::real, array[768]), ',') || ']')::vector;
begin
  select count(*) into n
  from public.match_knowledge(qe, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 50, 0.0);
  if n < 1 then
    raise exception 'BROKEN: Alice cannot retrieve her own data (got % row(s))', n;
  end if;
  raise notice 'PASS 3: owner retrieves own data (% row(s))', n;
end $$;

do $$ begin raise notice 'ALL ISOLATION ASSERTIONS PASSED'; end $$;

reset role;
rollback;
