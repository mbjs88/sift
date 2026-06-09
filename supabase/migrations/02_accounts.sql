-- Sift — multi-tenant core
-- Data is NEVER keyed directly to a user. Every knowledge row belongs to an
-- account. Accounts model personal brains, "Family Brains", and B2B tenants.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.accounts (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  account_type text not null default 'personal'
              check (account_type in ('personal','family','enterprise')),
  created_at  timestamptz not null default now()
);

create table if not exists public.account_members (
  account_id  uuid not null references public.accounts(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null default 'member'
              check (role in ('owner','admin','member')),
  created_at  timestamptz not null default now(),
  primary key (account_id, user_id)
);

create index if not exists account_members_user_idx
  on public.account_members (user_id);

-- ---------------------------------------------------------------------------
-- Membership helpers
-- SECURITY DEFINER is required here to read account_members WITHOUT triggering
-- the table's own RLS — otherwise policies that call these helpers recurse.
-- Each function is scoped to auth.uid(), so it can only ever reveal the
-- CURRENT user's memberships. No cross-tenant leak is possible.
-- ---------------------------------------------------------------------------
create or replace function public.auth_account_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select account_id
  from public.account_members
  where user_id = auth.uid()
$$;

create or replace function public.is_account_member(p_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.account_members
    where account_id = p_account_id
      and user_id = auth.uid()
  )
$$;

create or replace function public.is_account_admin(p_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.account_members
    where account_id = p_account_id
      and user_id = auth.uid()
      and role in ('owner','admin')
  )
$$;

-- Atomic account creation: insert the account and enroll the creator as owner
-- in one transaction, so an account can never exist with zero members.
create or replace function public.create_account(p_name text, p_type text default 'personal')
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_account_id uuid;
begin
  if auth.uid() is null then
    raise exception 'create_account requires an authenticated user';
  end if;

  insert into public.accounts (name, account_type)
  values (p_name, p_type)
  returning id into v_account_id;

  insert into public.account_members (account_id, user_id, role)
  values (v_account_id, auth.uid(), 'owner');

  return v_account_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.accounts        enable row level security;
alter table public.account_members enable row level security;

-- A user sees only accounts they belong to.
drop policy if exists accounts_select on public.accounts;
create policy accounts_select on public.accounts
  for select to authenticated
  using (id in (select public.auth_account_ids()));

-- Direct INSERT/UPDATE/DELETE of accounts is blocked; use create_account().
-- (No permissive write policy = denied by default under RLS.)

-- A user sees the membership rows of accounts they belong to.
drop policy if exists members_select on public.account_members;
create policy members_select on public.account_members
  for select to authenticated
  using (account_id in (select public.auth_account_ids()));

-- Only owners/admins may add or remove members.
drop policy if exists members_write on public.account_members;
create policy members_write on public.account_members
  for all to authenticated
  using (public.is_account_admin(account_id))
  with check (public.is_account_admin(account_id));
