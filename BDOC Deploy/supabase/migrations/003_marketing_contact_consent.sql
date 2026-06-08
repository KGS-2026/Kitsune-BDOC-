-- KGS BDOC — Migration 003: Marketing Contact Capture + Consent
-- Phase 32 (2026-06-02)
--
-- Adds phone number + explicit marketing-consent tracking to profiles so the
-- operator can run email/SMS campaigns ONLY to users who opted in.
--
-- Legal note (CAN-SPAM / TCPA): a defensible consent record needs WHAT they
-- agreed to (consent_version), WHEN (marketing_consent_at), and a clear
-- affirmative action (marketing_consent = true, set only when the box is checked).
-- This migration stores all three. Do NOT email/SMS anyone where
-- marketing_consent = false.
--
-- Run in Supabase SQL Editor: Dashboard > SQL Editor > New Query > Paste > Run

-- Step 1: add the columns (idempotent)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS marketing_consent BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS marketing_consent_at TIMESTAMPTZ;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS consent_version TEXT;

-- Step 2: replace the new-user trigger so it copies phone + consent from the
-- signup metadata (options.data) into the profile. Runs as SECURITY DEFINER,
-- so it writes the locked columns without needing client-side UPDATE grants.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (
    id, email, display_name, phone,
    marketing_consent, marketing_consent_at, consent_version
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    NULLIF(NEW.raw_user_meta_data->>'phone', ''),
    COALESCE((NEW.raw_user_meta_data->>'marketing_consent')::boolean, false),
    CASE
      WHEN (NEW.raw_user_meta_data->>'marketing_consent')::boolean THEN now()
      ELSE NULL
    END,
    NULLIF(NEW.raw_user_meta_data->>'consent_version', '')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 3: index for fast "who consented" export queries
CREATE INDEX IF NOT EXISTS idx_profiles_marketing_consent
  ON public.profiles(marketing_consent)
  WHERE marketing_consent = true;

-- Step 4 (optional, for existing users): let signed-in users opt in/out later.
-- Column-level UPDATE grant so they can change their own consent + phone,
-- without being able to touch tier / stripe / api_key (kept service-role-only).
GRANT UPDATE (phone, marketing_consent, marketing_consent_at, display_name)
  ON public.profiles TO authenticated;
