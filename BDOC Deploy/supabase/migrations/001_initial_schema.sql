-- KGS BDOC v8.0 — Initial Database Schema
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor > New Query)

-- ============================================
-- 1. PROFILES TABLE (extends auth.users)
-- ============================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  display_name TEXT,
  tier TEXT NOT NULL DEFAULT 'recon'
    CHECK (tier IN ('recon', 'operator', 'analyst', 'enterprise')),
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  api_key TEXT UNIQUE DEFAULT gen_random_uuid()::text,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Row-Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Service role can do anything (for webhook handler)
CREATE POLICY "Service role full access"
  ON public.profiles FOR ALL
  USING (auth.role() = 'service_role');

-- ============================================
-- 2. AUTO-CREATE PROFILE ON SIGNUP
-- ============================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (NEW.id, NEW.email);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop existing trigger if present (idempotent)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================
-- 3. AUDIT LOG
-- ============================================
CREATE TABLE IF NOT EXISTS public.audit_log (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id),
  action TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own audit entries"
  ON public.audit_log FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access on audit"
  ON public.audit_log FOR ALL
  USING (auth.role() = 'service_role');

-- ============================================
-- 4. HEARTBEATS (for Health monitoring)
-- ============================================
CREATE TABLE IF NOT EXISTS public.heartbeats (
  id BIGSERIAL PRIMARY KEY,
  feeds JSONB,
  system TEXT,
  timestamp TIMESTAMPTZ,
  version TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Heartbeats are written by service role via proxy
ALTER TABLE public.heartbeats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role writes heartbeats"
  ON public.heartbeats FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Anyone can read heartbeats"
  ON public.heartbeats FOR SELECT
  USING (true);

-- Auto-cleanup: keep only last 7 days of heartbeats
-- (Run as a cron job or Supabase scheduled function)
-- DELETE FROM public.heartbeats WHERE created_at < now() - interval '7 days';

-- ============================================
-- 5. INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_profiles_stripe_sub
  ON public.profiles(stripe_subscription_id);

CREATE INDEX IF NOT EXISTS idx_profiles_stripe_cust
  ON public.profiles(stripe_customer_id);

CREATE INDEX IF NOT EXISTS idx_audit_log_user_time
  ON public.audit_log(user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_heartbeats_time
  ON public.heartbeats(created_at);
