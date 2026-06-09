-- Sift — auto-provision a personal account on signup.
--
-- Without this, a freshly signed-in user belongs to no account, so
-- resolveActiveAccount() returns null and every ingest/synthesis call 409s.
-- This trigger gives each new auth user their own "personal brain" the moment
-- the account is created, enrolling them as owner.
--
-- Note: create_account() can't be reused here — it keys off auth.uid(), which
-- is null inside a signup trigger. We use NEW.id directly. SECURITY DEFINER so
-- the trigger can write through RLS; it only ever references the new user's id.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_account_id uuid;
  v_label text;
begin
  v_label := coalesce(
    nullif(new.raw_user_meta_data->>'full_name', ''),
    nullif(new.raw_user_meta_data->>'name', ''),
    split_part(new.email, '@', 1),
    'My'
  );

  insert into public.accounts (name, account_type)
  values (v_label || '''s Sift', 'personal')
  returning id into v_account_id;

  insert into public.account_members (account_id, user_id, role)
  values (v_account_id, new.id, 'owner');

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
