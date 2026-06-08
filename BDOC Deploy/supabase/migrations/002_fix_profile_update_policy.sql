-- KGS BDOC v8.0 — Security Patch: Profile Update RLS
-- Phase 24 (2026-05-23)
--
-- BUG: The original "Users can update own profile" policy allowed authenticated
-- users to UPDATE any column on their own row — including `tier`, `stripe_customer_id`,
-- and `stripe_subscription_id`. A user could call the Supabase API directly to
-- self-escalate from recon → enterprise for free.
--
-- FIX:
--   1. Drop the overpermissive UPDATE policy.
--   2. Create a narrower policy that still guards by row ownership.
--   3. Use column-level REVOKE + GRANT to whitelist the only column users
--      legitimately need to update client-side: `display_name`.
--      Tier, stripe_*, and api_key are set exclusively by the service-role webhook.
--
-- Run in Supabase SQL Editor: Dashboard → SQL Editor → New Query → Paste → Run

-- Step 1: drop the old policy
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

-- Step 2: row-ownership policy (still required for PostgREST to accept the request)
CREATE POLICY "Users can update own display_name"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Step 3: column-level restriction — authenticated users may only write display_name.
-- Sensitive columns (tier, stripe_customer_id, stripe_subscription_id, api_key)
-- remain writable only by the service role (see "Service role full access" policy).
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT  UPDATE (display_name) ON public.profiles TO authenticated;
