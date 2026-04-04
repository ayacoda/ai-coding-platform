-- ============================================================
-- AI Coding Platform — PLATFORM Schema (public)
-- ⚠️  This schema is RESERVED for the platform application only.
--     User-generated app tables must NEVER go in `public`.
--     Each generated app gets its own isolated schema (e.g. p_a1b2c3d4).
-- ============================================================

-- Profiles (auto-created on signup via trigger)
CREATE TABLE IF NOT EXISTS public.profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       TEXT,
  name        TEXT,
  avatar_url  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Projects
CREATE TABLE IF NOT EXISTS public.projects (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name           TEXT NOT NULL DEFAULT 'Untitled Project',
  description    TEXT,
  files          JSONB NOT NULL DEFAULT '{}',
  messages       JSONB NOT NULL DEFAULT '[]',
  prompt_queue   JSONB NOT NULL DEFAULT '[]',
  queue_paused   BOOLEAN NOT NULL DEFAULT false,
  storage_mode   TEXT NOT NULL DEFAULT 'localstorage',
  project_config JSONB,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Add messages column to existing databases that don't have it yet
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS messages JSONB NOT NULL DEFAULT '[]';
-- Add queue columns to existing databases
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS prompt_queue JSONB NOT NULL DEFAULT '[]';
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS queue_paused BOOLEAN NOT NULL DEFAULT false;

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS projects_updated_at ON public.projects;
CREATE TRIGGER projects_updated_at
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ── Billing columns on profiles ──────────────────────────────────────────────
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS credits            INTEGER     NOT NULL DEFAULT 100;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS plan               TEXT        NOT NULL DEFAULT 'free';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS credits_reset_at   TIMESTAMPTZ;

-- Credit transactions log
CREATE TABLE IF NOT EXISTS public.credit_transactions (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  amount      INTEGER     NOT NULL,          -- positive = added, negative = deducted
  type        TEXT        NOT NULL,          -- deduction|credit_purchase|subscription_grant|signup_grant
  description TEXT,
  metadata    JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own transactions" ON public.credit_transactions;
CREATE POLICY "Users can read own transactions" ON public.credit_transactions
  FOR SELECT USING (auth.uid() = user_id);

-- Auto-create profile on signup (grants 100 signup credits + logs transaction)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  new_profile_id UUID;
BEGIN
  INSERT INTO public.profiles (id, email, name, credits, plan)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    100,
    'free'
  )
  RETURNING id INTO new_profile_id;

  INSERT INTO public.credit_transactions (user_id, amount, type, description)
  VALUES (NEW.id, 100, 'signup_grant', 'Welcome credits — free tier');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Row Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

-- Profiles policies
DROP POLICY IF EXISTS "Users can read own profile" ON public.profiles;
CREATE POLICY "Users can read own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

-- Projects policies
DROP POLICY IF EXISTS "Users can CRUD own projects" ON public.projects;
CREATE POLICY "Users can CRUD own projects" ON public.projects
  FOR ALL USING (auth.uid() = user_id);

-- Project versions (version control snapshots)
CREATE TABLE IF NOT EXISTS public.project_versions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  label       TEXT,
  files       JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.project_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can CRUD own versions" ON public.project_versions;
CREATE POLICY "Users can CRUD own versions" ON public.project_versions
  FOR ALL USING (auth.uid() = user_id);

-- Grant schema + table access to Supabase roles (required in newer Supabase projects)
-- service_role is used by the server's admin client for billing queries — must be explicit
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON public.profiles TO anon, authenticated, service_role;
GRANT ALL ON public.projects TO anon, authenticated, service_role;
GRANT ALL ON public.project_versions TO anon, authenticated, service_role;
GRANT ALL ON public.credit_transactions TO anon, authenticated, service_role;
-- Sequence grants so INSERT with gen_random_uuid() works for all roles
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
