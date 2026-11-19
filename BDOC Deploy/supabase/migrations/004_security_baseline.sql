-- 004_security_baseline.sql — p204, item 1b chunk C (2026-11-19)
--
-- Run in Supabase → SQL Editor as ONE script, only after Travon says "deploy".
-- Safe to run more than once. Runs inside one transaction: if any line fails, nothing changes.
--
-- What it does:
--   A. Brings production up to 002 + 003. A read-only check on 2026-11-19 found that
--      profiles.marketing_consent does not exist live, so 003 was never run: the signup
--      consent box has been silently dropped and export-contacts cannot work.
--   B. Least privilege on every table: RLS on everywhere; the public (anon) role can read
--      nothing it doesn't need and write nothing at all; signed-in users read their own
--      profile and audit rows, and may change only display_name, phone and marketing_consent.
--   C. marketing_consent_at is stamped by the database, not by the browser (a user could
--      otherwise backdate their own consent record).
--   D. SECURITY DEFINER functions get a fixed search_path (Supabase Security Advisor
--      "function_search_path_mutable").
--   E. heartbeats is write-only telemetry: nobody reads it through the API, so the public
--      read policy goes. Writes keep coming through proxy-supabase (service role).
--
-- What it does NOT do: FORCE ROW LEVEL SECURITY. handle_new_user() runs as the table owner,
-- and FORCE would make signup fail. The service role bypasses RLS by design.
--
-- After running: section F at the bottom prints the result. Expected output is in its comments.

begin;

-- ═══ A. bring production up to 002 + 003 (idempotent) ══════════════════════════════════
alter table public.profiles add column if not exists phone                text;
alter table public.profiles add column if not exists marketing_consent    boolean not null default false;
alter table public.profiles add column if not exists marketing_consent_at timestamptz;
alter table public.profiles add column if not exists consent_version      text;

create index if not exists idx_profiles_marketing_consent
  on public.profiles(marketing_consent) where marketing_consent = true;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (
    id, email, display_name, phone,
    marketing_consent, marketing_consent_at, consent_version
  )
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    nullif(new.raw_user_meta_data->>'phone', ''),
    coalesce((new.raw_user_meta_data->>'marketing_consent')::boolean, false),
    case when coalesce((new.raw_user_meta_data->>'marketing_consent')::boolean, false)
         then now() else null end,
    nullif(new.raw_user_meta_data->>'consent_version', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- The trigger on auth.users (from 001) is left alone: replacing the function is enough, and
-- Supabase restricts changes to the auth schema. F4 below confirms the trigger is there.

-- ═══ B. RLS on for every table in public; no table is ever left open ═══════════════════
do $$
declare r record;
begin
  for r in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
  loop
    execute format('alter table public.%I enable row level security', r.relname);
    raise notice 'RLS was OFF, now ON: public.%', r.relname;
  end loop;
end $$;

-- Nobody outside the service role ever needs these on any table.
do $$
declare r record;
begin
  for r in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
  loop
    execute format('revoke truncate, references, trigger on public.%I from anon, authenticated', r.relname);
  end loop;
end $$;

-- profiles: signed-in users read their own row and change three columns of it.
revoke all on public.profiles from anon;
revoke insert, update, delete on public.profiles from authenticated;
-- Table-level revokes leave column-level grants (002/003 added some) in place, so clear those too.
do $$
declare col text;
begin
  for col in
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
  loop
    execute format('revoke select (%1$I), insert (%1$I), update (%1$I), references (%1$I) on public.profiles from anon', col);
    execute format('revoke insert (%1$I), update (%1$I), references (%1$I) on public.profiles from authenticated', col);
  end loop;
end $$;
grant select on public.profiles to authenticated;
grant update (display_name, phone, marketing_consent) on public.profiles to authenticated;

drop policy if exists "Users can update own profile"      on public.profiles;  -- 001's hole (every column)
drop policy if exists "Users can update own display_name" on public.profiles;  -- 002's name, replaced below
drop policy if exists "Users can read own profile"        on public.profiles;
drop policy if exists "Service role full access"          on public.profiles;  -- the service role bypasses RLS anyway
drop policy if exists "profiles: read own"                on public.profiles;
drop policy if exists "profiles: update own"              on public.profiles;

create policy "profiles: read own" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);
create policy "profiles: update own" on public.profiles
  for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

-- audit_log: signed-in users read their own entries; only the service role writes.
revoke all on public.audit_log from anon;
revoke insert, update, delete on public.audit_log from authenticated;
grant select on public.audit_log to authenticated;
drop policy if exists "Users can read own audit entries"  on public.audit_log;
drop policy if exists "Service role full access on audit" on public.audit_log;
drop policy if exists "audit_log: read own"               on public.audit_log;
create policy "audit_log: read own" on public.audit_log
  for select to authenticated using ((select auth.uid()) = user_id);

-- ═══ E. heartbeats: service role only ═════════════════════════════════════════════════
revoke all on public.heartbeats from anon, authenticated;
drop policy if exists "Anyone can read heartbeats"     on public.heartbeats;
drop policy if exists "Service role writes heartbeats" on public.heartbeats;

-- mesh tables, if docs/mesh-setup.sql was ever run: public read stays, browser writes go
-- (mesh-ingest writes with the service role behind its own key).
do $$
declare t text;
begin
  foreach t in array array['mesh_nodes', 'mesh_messages', 'mesh_trail', 'mesh_telemetry'] loop
    if to_regclass('public.' || t) is not null then
      execute format('revoke insert, update, delete on public.%I from anon, authenticated', t);
      execute format('drop policy if exists %I on public.%I', 'Mesh nodes authenticated write', t);
      execute format('drop policy if exists %I on public.%I', 'Mesh messages authenticated insert', t);
      execute format('drop policy if exists %I on public.%I', 'Mesh trail authenticated insert', t);
      execute format('drop policy if exists %I on public.%I', 'Mesh telemetry authenticated insert', t);
      raise notice 'mesh table locked to service-role writes: public.%', t;
    end if;
  end loop;
end $$;

-- ═══ C. consent timestamps come from the database ═════════════════════════════════════
create or replace function public.profiles_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  if (select auth.role()) = 'authenticated' then
    if new.marketing_consent is distinct from old.marketing_consent then
      new.marketing_consent_at := case when new.marketing_consent then now() else null end;
    else
      new.marketing_consent_at := old.marketing_consent_at;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_stamp on public.profiles;
create trigger profiles_stamp
  before update on public.profiles
  for each row execute function public.profiles_stamp();

-- ═══ D. functions: nobody calls the trigger functions directly ════════════════════════
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.profiles_stamp()  from public, anon, authenticated;

-- List any other SECURITY DEFINER function in public without a fixed search_path (fix by hand).
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as fn
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
  loop
    raise notice 'REVIEW: security definer without search_path: %', r.fn;
  end loop;
end $$;

commit;

-- ═══ F. proof (read-only) ═════════════════════════════════════════════════════════════
-- F1. Expected: no rows.
select c.relname as table_without_rls
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity;

-- F2. Expected: authenticated UPDATE only on display_name, marketing_consent, phone; nothing for anon.
select grantee, privilege_type, column_name
from information_schema.column_privileges
where table_schema = 'public' and table_name = 'profiles'
  and grantee in ('anon', 'authenticated') and privilege_type <> 'SELECT'
order by grantee, column_name;

-- F3. Expected: profiles "read own" + "update own", audit_log "read own", mesh_* public reads only.
select tablename, policyname, cmd, roles, qual
from pg_policies where schemaname = 'public'
order by tablename, cmd;

-- F4. Expected: one row, on_auth_user_created → handle_new_user (signup still creates a profile).
select tgname, tgfoid::regproc as fn, tgenabled
from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal;
