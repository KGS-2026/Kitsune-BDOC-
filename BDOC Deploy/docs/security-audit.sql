-- ═══════════════════════════════════════════════════════════════════════════
-- BDOC SECURITY AUDIT + HARDENING — p158
-- Run in Supabase → SQL Editor, top to bottom. Read the output of section 0
-- before running anything that changes state.
--
-- Written as CISO work, not a patch: section 0 tells you whether you have
-- already been exploited, section 1 closes the hole, section 2 makes it
-- impossible to reopen by accident, section 5 proves it.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══ 0. AUDIT FIRST — RUN THESE AND READ THE OUTPUT ═══════════════════════

-- 0a. THE CRITICAL QUESTION: can a signed-in user change their own tier?
-- `001_initial_schema.sql` created:
--     CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE
--       USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
-- That grants UPDATE on EVERY COLUMN of their own row — including `tier`.
-- `002_fix_profile_update_policy.sql` fixes it, but nobody has confirmed 002
-- was ever actually run against production.
--
-- EXPECTED IF SAFE: exactly one row -> display_name
-- IF YOU SEE tier / stripe_customer_id / is_admin: the subscription business
-- is currently voluntary. Run section 1 immediately.
select grantee, privilege_type, column_name
from information_schema.column_privileges
where table_schema = 'public' and table_name = 'profiles'
  and grantee in ('authenticated','anon')
order by grantee, column_name;

-- 0b. Has anyone already self-upgraded?
-- A paid tier with no Stripe subscription id is either a manual grant by you
-- or an exploited row. Investigate every one.
select id, email, tier, stripe_customer_id, stripe_subscription_id,
       created_at, updated_at,
       case
         when tier <> 'recon' and stripe_subscription_id is null
           then 'REVIEW — paid tier, no Stripe subscription'
         else 'ok'
       end as flag
from public.profiles
order by updated_at desc;

-- 0c. Any table in public with RLS OFF is readable/writable with the PUBLIC
-- anon key that ships in every browser. This list must be empty.
select c.relname as table_without_rls
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;

-- 0d. Every policy currently in force. Look for USING (true) on anything
-- that is not deliberately public.
select tablename, policyname, cmd, roles, qual, with_check
from pg_policies where schemaname = 'public'
order by tablename, cmd;

-- 0e. Views can leak past RLS when they are SECURITY DEFINER.
select schemaname, viewname, viewowner
from pg_views where schemaname = 'public';


-- ═══ 1. PROFILES — least privilege ════════════════════════════════════════
-- The browser only ever needs to READ its own row. Everything that matters
-- (tier, Stripe ids) is written by the webhook with the service role, which
-- bypasses RLS by design.

alter table public.profiles enable row level security;
alter table public.profiles force row level security;   -- applies to the owner too

drop policy if exists "Users can read own profile"     on public.profiles;
drop policy if exists "Users can update own profile"   on public.profiles;  -- the hole
drop policy if exists "Users can update own display_name" on public.profiles;
drop policy if exists "profiles_select_own"            on public.profiles;

create policy "profiles_select_own" on public.profiles
  for select to authenticated using (id = auth.uid());

-- Column-level: strip UPDATE entirely, then hand back ONLY display_name.
-- Doing it in this order matters — a later GRANT cannot widen what was never
-- given back.
revoke insert, update, delete on public.profiles from anon, authenticated;
revoke all    on public.profiles from anon;
grant  select on public.profiles to authenticated;
grant  update (display_name) on public.profiles to authenticated;


-- ═══ 2. DEFENCE IN DEPTH — trigger that cannot be bypassed by a policy ════
-- Section 1 is correct but reversible: anyone who later writes a permissive
-- policy silently reopens the hole. This trigger blocks the write itself, no
-- matter what the policies say. Only the service role can move these columns.

create or replace function public.bdoc_protect_billing()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  k text;
  locked text[] := array['tier','stripe_customer_id','stripe_subscription_id',
                         'subscription_status','current_period_end','is_admin','role'];
begin
  if coalesce(auth.role(), current_user) in ('service_role','postgres','supabase_admin') then
    return new;
  end if;
  foreach k in array locked loop
    if (to_jsonb(new) ? k) and (to_jsonb(new)->k is distinct from to_jsonb(old)->k) then
      raise exception 'BDOC: column % is server-managed', k using errcode = '42501';
    end if;
  end loop;
  return new;
end $$;

drop trigger if exists bdoc_protect_billing on public.profiles;
create trigger bdoc_protect_billing before update on public.profiles
  for each row execute function public.bdoc_protect_billing();


-- ═══ 3. AUDIT TRAIL ON TIER CHANGES ═══════════════════════════════════════
-- Data minimisation doctrine: log the FACT of a change, never PII. Email is
-- deliberately not copied here — profiles already holds it once.

create table if not exists public.tier_audit (
  id          bigserial primary key,
  profile_id  uuid not null,
  old_tier    text,
  new_tier    text,
  changed_by  text,
  changed_at  timestamptz not null default now()
);
alter table public.tier_audit enable row level security;   -- no policies = server-only
revoke all on public.tier_audit from anon, authenticated;

create or replace function public.bdoc_log_tier()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.tier is distinct from old.tier then
    insert into public.tier_audit(profile_id, old_tier, new_tier, changed_by)
    values (new.id, old.tier, new.tier, coalesce(auth.role(), current_user));
  end if;
  return new;
end $$;

drop trigger if exists bdoc_log_tier on public.profiles;
create trigger bdoc_log_tier after update on public.profiles
  for each row execute function public.bdoc_log_tier();


-- ═══ 4. DURABLE RATE LIMIT (used by netlify/functions/_lib/guard.js) ══════
-- The in-process limiter in guard.js only sees one warm Lambda instance.
-- This one is shared across every instance.

create table if not exists public.bdoc_rate (
  key text primary key, n int not null, reset_at timestamptz not null
);
alter table public.bdoc_rate enable row level security;
revoke all on public.bdoc_rate from anon, authenticated;

create or replace function public.bdoc_rate_hit(p_key text, p_max int, p_window_sec int)
returns boolean language plpgsql security definer set search_path = public as $$
declare r public.bdoc_rate;
begin
  insert into public.bdoc_rate as t (key, n, reset_at)
  values (p_key, 1, now() + make_interval(secs => p_window_sec))
  on conflict (key) do update set
    n = case when t.reset_at < now() then 1 else t.n + 1 end,
    reset_at = case when t.reset_at < now()
                    then now() + make_interval(secs => p_window_sec)
                    else t.reset_at end
  returning * into r;
  return r.n > p_max;   -- true = limited
end $$;
revoke execute on function public.bdoc_rate_hit(text,int,int) from anon, authenticated, public;


-- ═══ 5. VERIFY — re-run and confirm ═══════════════════════════════════════

-- 5a. Must now return exactly ONE row: display_name.
select grantee, privilege_type, column_name
from information_schema.column_privileges
where table_schema = 'public' and table_name = 'profiles'
  and grantee = 'authenticated' and privilege_type = 'UPDATE';

-- 5b. Must return zero rows.
select c.relname as still_no_rls
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;

-- 5c. THE REAL TEST — run this as a normal signed-in user, not in the SQL
-- editor (the editor runs as a superuser and will succeed, proving nothing).
-- In the BDOC tab, DevTools console, while signed in:
--
--   await Auth.client.from('profiles')
--     .update({ tier: 'enterprise' })
--     .eq('id', (await Auth.client.auth.getUser()).data.user.id)
--
-- MUST fail with "column tier is server-managed" or a permission error.
-- If it succeeds, STOP and re-run sections 1 and 2.
