-- FRESH EMPTY TARGET ONLY. Never run this after production data import.
BEGIN;
-- Read-only checks; no objects/records are dropped. The operator must verify
-- the actual connection against the approved new-project dashboard first.
DO $preflight$
DECLARE
  target_ref text := current_setting('app.lovable_exit_target_ref', true);
BEGIN
  IF current_setting('app.lovable_exit_target_confirmed', true) IS DISTINCT FROM 'true'
     OR target_ref IS NULL OR target_ref !~ '^[a-z]{20}$'
     OR target_ref IN ('zisrsttmjeipkmllqubi', 'dbdkvrkmeowdydizrsmn') THEN
    RAISE EXCEPTION 'A verified NEW target project is required. Production source and existing TJK project are protected';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'An administrative target database connection is required';
  END IF;
  IF to_regclass('auth.users') IS NULL OR to_regclass('storage.buckets') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
    RAISE EXCEPTION 'Initialized compatible Supabase auth/storage/realtime services are required';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m')
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e')) THEN
    RAISE EXCEPTION 'Existing public application relations found; schema history may only run on a fresh empty target';
  END IF;
  IF EXISTS (SELECT 1 FROM auth.users) OR EXISTS (SELECT 1 FROM storage.buckets)
     OR EXISTS (SELECT 1 FROM storage.objects) THEN
    RAISE EXCEPTION 'Existing target auth users or Storage data found; fresh schema reconstruction is blocked';
  END IF;
END
$preflight$;


-- Source migration: 20260308235733_8c32bbec-c442-41be-882c-5cfa31c1731f.sql
-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
NEW.updated_at = now();
RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Profiles
CREATE TABLE public.profiles (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Cases
CREATE TABLE public.cases (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    priority TEXT NOT NULL DEFAULT 'medium',
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
ALTER TABLE public.cases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own cases" ON public.cases USING (auth.uid() = owner_id);
CREATE TRIGGER update_cases_updated_at BEFORE UPDATE ON public.cases FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Subjects
CREATE TABLE public.subjects (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    case_id UUID NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own subjects" ON public.subjects USING (auth.uid() = owner_id);
CREATE TRIGGER update_subjects_updated_at BEFORE UPDATE ON public.subjects FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Artifacts
CREATE TABLE public.artifacts (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    case_id UUID NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    content TEXT,
    type TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
ALTER TABLE public.artifacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own artifacts" ON public.artifacts USING (auth.uid() = owner_id);
CREATE TRIGGER update_artifacts_updated_at BEFORE UPDATE ON public.artifacts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Events
CREATE TABLE public.events (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    case_id UUID NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    event_time TIMESTAMP WITH TIME ZONE,
    type TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own events" ON public.events USING (auth.uid() = owner_id);
CREATE TRIGGER update_events_updated_at BEFORE UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Tool Results
CREATE TABLE public.tool_results (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    case_id UUID REFERENCES public.cases(id) ON DELETE CASCADE,
    tool_name TEXT NOT NULL,
    result_data JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
ALTER TABLE public.tool_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own tool results" ON public.tool_results USING (auth.uid() = owner_id);
CREATE TRIGGER update_tool_results_updated_at BEFORE UPDATE ON public.tool_results FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Source migration: 20260310091852_75b7807d-8112-4e3f-ad0c-bec98de66991.sql

-- Drop existing tables (order matters due to FK references)
DROP TABLE IF EXISTS tool_results CASCADE;
DROP TABLE IF EXISTS events CASCADE;
DROP TABLE IF EXISTS artifacts CASCADE;
DROP TABLE IF EXISTS subjects CASCADE;
DROP TABLE IF EXISTS cases CASCADE;
DROP TABLE IF EXISTS profiles CASCADE;

-- profiles: id is the auth.users id directly
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'analyst',
  name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

-- cases
CREATE TABLE public.cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.cases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own cases" ON public.cases FOR ALL TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

-- subjects
CREATE TABLE public.subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own subjects" ON public.subjects FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.cases WHERE cases.id = subjects.case_id AND cases.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.cases WHERE cases.id = subjects.case_id AND cases.owner_id = auth.uid()));

-- artifacts
CREATE TABLE public.artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  artifact_type text NOT NULL,
  data text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.artifacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own artifacts" ON public.artifacts FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.cases WHERE cases.id = artifacts.case_id AND cases.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.cases WHERE cases.id = artifacts.case_id AND cases.owner_id = auth.uid()));

-- events
CREATE TABLE public.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  event_type text,
  timestamp timestamptz,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own events" ON public.events FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.cases WHERE cases.id = events.case_id AND cases.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.cases WHERE cases.id = events.case_id AND cases.owner_id = auth.uid()));

-- tool_results
CREATE TABLE public.tool_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_name text NOT NULL,
  case_id uuid REFERENCES public.cases(id) ON DELETE CASCADE,
  result_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.tool_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own tool_results" ON public.tool_results FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.cases WHERE cases.id = tool_results.case_id AND cases.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.cases WHERE cases.id = tool_results.case_id AND cases.owner_id = auth.uid()));


-- Source migration: 20260310092016_f5b635b0-e1e6-4ac7-8caf-bf85e59e8a68.sql

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, role, name)
  VALUES (NEW.id, 'investigator', COALESCE(NEW.raw_user_meta_data->>'name', NEW.email));
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- Source migration: 20260310092525_892f9ee7-e822-4f5d-ab1a-57b8c08bacaa.sql

-- Create artifacts storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('artifacts', 'artifacts', false);

-- RLS: Only artifact owners can upload (owner_id folder structure: owner_id/case_id/filename)
CREATE POLICY "Owners can upload artifacts"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'artifacts'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- RLS: Only artifact owners can read their files
CREATE POLICY "Owners can read own artifacts"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'artifacts'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- RLS: Only artifact owners can delete their files
CREATE POLICY "Owners can delete own artifacts"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'artifacts'
  AND (storage.foldername(name))[1] = auth.uid()::text
);


-- Source migration: 20260310092800_fbd5c1b3-b915-4cd5-b679-01159bcb734d.sql

-- Enable realtime for dashboard live updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.cases;
ALTER PUBLICATION supabase_realtime ADD TABLE public.artifacts;
ALTER PUBLICATION supabase_realtime ADD TABLE public.events;
ALTER PUBLICATION supabase_realtime ADD TABLE public.tool_results;


-- Source migration: 20260310092912_4b315eec-5fcc-4375-8153-abb5a764a87a.sql

CREATE TABLE public.evidence_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id uuid NOT NULL REFERENCES public.artifacts(id) ON DELETE CASCADE,
  action text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  timestamp timestamptz NOT NULL DEFAULT now(),
  hash text NOT NULL
);

ALTER TABLE public.evidence_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view logs for own artifacts"
ON public.evidence_logs FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.artifacts a
    JOIN public.cases c ON c.id = a.case_id
    WHERE a.id = evidence_logs.artifact_id AND c.owner_id = auth.uid()
  )
);

CREATE POLICY "Users can insert own logs"
ON public.evidence_logs FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

-- Auto-log on artifact insert
CREATE OR REPLACE FUNCTION public.log_artifact_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.evidence_logs (artifact_id, action, user_id, hash)
  VALUES (
    NEW.id,
    'created',
    NEW.case_id::uuid, -- placeholder, replaced below
    md5(COALESCE(NEW.data, '') || NEW.artifact_type || NEW.id::text || now()::text)
  );
  -- fix user_id: derive from case owner
  UPDATE public.evidence_logs
  SET user_id = (SELECT owner_id FROM public.cases WHERE id = NEW.case_id)
  WHERE artifact_id = NEW.id AND action = 'created' AND user_id = NEW.case_id;
  RETURN NEW;
END;
$$;

-- Auto-log on artifact update
CREATE OR REPLACE FUNCTION public.log_artifact_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.evidence_logs (artifact_id, action, user_id, hash)
  VALUES (
    NEW.id,
    'modified',
    (SELECT owner_id FROM public.cases WHERE id = NEW.case_id),
    md5(COALESCE(NEW.data, '') || NEW.artifact_type || NEW.id::text || now()::text)
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_artifact_insert_log
  AFTER INSERT ON public.artifacts
  FOR EACH ROW EXECUTE FUNCTION public.log_artifact_insert();

CREATE TRIGGER trg_artifact_update_log
  AFTER UPDATE ON public.artifacts
  FOR EACH ROW EXECUTE FUNCTION public.log_artifact_update();

ALTER PUBLICATION supabase_realtime ADD TABLE public.evidence_logs;


-- Source migration: 20260310092928_c7cec519-d382-496e-b11f-f55555d1efca.sql

-- Replace the insert trigger with a clean version
CREATE OR REPLACE FUNCTION public.log_artifact_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_id uuid;
BEGIN
  SELECT owner_id INTO v_owner_id FROM public.cases WHERE id = NEW.case_id;
  INSERT INTO public.evidence_logs (artifact_id, action, user_id, hash)
  VALUES (
    NEW.id,
    'created',
    v_owner_id,
    md5(COALESCE(NEW.data, '') || NEW.artifact_type || NEW.id::text || now()::text)
  );
  RETURN NEW;
END;
$$;


-- Source migration: 20260310093044_d6c1a896-4c9b-4306-b87b-bb8ac8878e43.sql

-- Entities: nodes in the graph (subjects, emails, domains, usernames, IPs)
CREATE TABLE public.entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  entity_type text NOT NULL, -- 'subject','email','domain','username','ip'
  label text NOT NULL,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.entities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own entities" ON public.entities FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.cases WHERE cases.id = entities.case_id AND cases.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.cases WHERE cases.id = entities.case_id AND cases.owner_id = auth.uid()));

-- Relationships: edges between entities
CREATE TABLE public.entity_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  target_id uuid NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  relationship_type text NOT NULL, -- 'owns','uses','resolves_to','linked','communicates'
  confidence numeric DEFAULT 1.0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.entity_relationships ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own relationships" ON public.entity_relationships FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.cases WHERE cases.id = entity_relationships.case_id AND cases.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.cases WHERE cases.id = entity_relationships.case_id AND cases.owner_id = auth.uid()));

ALTER PUBLICATION supabase_realtime ADD TABLE public.entities;
ALTER PUBLICATION supabase_realtime ADD TABLE public.entity_relationships;


-- Source migration: 20260310093311_f5e784e8-4612-4bb0-a57c-60f75153c335.sql

CREATE TABLE public.tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read tags" ON public.tags FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert tags" ON public.tags FOR INSERT TO authenticated WITH CHECK (true);

CREATE TABLE public.articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  content text NOT NULL DEFAULT '',
  summary text,
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tags text[] DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.articles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read articles" ON public.articles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authors can insert articles" ON public.articles FOR INSERT TO authenticated WITH CHECK (auth.uid() = author_id);
CREATE POLICY "Authors can update articles" ON public.articles FOR UPDATE TO authenticated USING (auth.uid() = author_id);
CREATE POLICY "Authors can delete articles" ON public.articles FOR DELETE TO authenticated USING (auth.uid() = author_id);

CREATE TRIGGER trg_articles_updated_at
  BEFORE UPDATE ON public.articles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- Source migration: 20260310093327_543ada6f-d52e-48a5-944f-8f8e4e68f4fb.sql

-- Tighten tags insert: require non-empty name (the USING(true) for INSERT is intentional for shared tags)
DROP POLICY "Authenticated users can insert tags" ON public.tags;
CREATE POLICY "Authenticated users can insert tags" ON public.tags FOR INSERT TO authenticated
  WITH CHECK (length(trim(name)) > 0);


-- Source migration: 20260310093532_b06416ae-6050-472a-a9ca-469a97326afa.sql

-- Courses
CREATE TABLE public.courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  difficulty text NOT NULL DEFAULT 'beginner',
  tags text[] DEFAULT '{}',
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone authed can read published courses" ON public.courses FOR SELECT TO authenticated USING (published = true OR auth.uid() = author_id);
CREATE POLICY "Authors can insert courses" ON public.courses FOR INSERT TO authenticated WITH CHECK (auth.uid() = author_id);
CREATE POLICY "Authors can update courses" ON public.courses FOR UPDATE TO authenticated USING (auth.uid() = author_id);
CREATE POLICY "Authors can delete courses" ON public.courses FOR DELETE TO authenticated USING (auth.uid() = author_id);
CREATE TRIGGER trg_courses_updated BEFORE UPDATE ON public.courses FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Modules (sections within a course)
CREATE TABLE public.modules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  title text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.modules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read modules of visible courses" ON public.modules FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.courses WHERE courses.id = modules.course_id AND (courses.published = true OR courses.author_id = auth.uid())));
CREATE POLICY "Authors can manage modules" ON public.modules FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.courses WHERE courses.id = modules.course_id AND courses.author_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.courses WHERE courses.id = modules.course_id AND courses.author_id = auth.uid()));

-- Lessons
CREATE TABLE public.lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id uuid NOT NULL REFERENCES public.modules(id) ON DELETE CASCADE,
  title text NOT NULL,
  content text NOT NULL DEFAULT '',
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.lessons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read lessons of visible courses" ON public.lessons FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.modules m JOIN public.courses c ON c.id = m.course_id
    WHERE m.id = lessons.module_id AND (c.published = true OR c.author_id = auth.uid())
  ));
CREATE POLICY "Authors can manage lessons" ON public.lessons FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.modules m JOIN public.courses c ON c.id = m.course_id
    WHERE m.id = lessons.module_id AND c.author_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.modules m JOIN public.courses c ON c.id = m.course_id
    WHERE m.id = lessons.module_id AND c.author_id = auth.uid()
  ));

-- Progress (enrollment + lesson completion)
CREATE TABLE public.progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  lesson_id uuid REFERENCES public.lessons(id) ON DELETE CASCADE,
  completed boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, course_id, lesson_id)
);
ALTER TABLE public.progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own progress" ON public.progress FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);


-- Source migration: 20260310093740_a8a7afe3-98bc-455d-a3ae-1e44061b4fff.sql

-- User roles table (separate from profiles per security best practices)
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Security definer function to check roles without recursive RLS
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- Only admins can read all roles
CREATE POLICY "Admins can read all roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR auth.uid() = user_id);

-- Only admins can manage roles
CREATE POLICY "Admins can insert roles" ON public.user_roles
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update roles" ON public.user_roles
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete roles" ON public.user_roles
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- System logs table
CREATE TABLE public.system_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  details jsonb DEFAULT '{}',
  level text NOT NULL DEFAULT 'info',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.system_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read system logs" ON public.system_logs
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Authenticated can insert logs" ON public.system_logs
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Allow profiles to be read by admins (add policy)
CREATE POLICY "Admins can read all profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));


-- Source migration: 20260310100911_9560f2f7-cd5a-49de-b32f-b082903fe8aa.sql

CREATE TABLE public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id text NOT NULL,
  stripe_subscription_id text,
  plan text NOT NULL DEFAULT 'free',
  status text NOT NULL DEFAULT 'active',
  current_period_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own subscription" ON public.subscriptions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Service role manages subscriptions" ON public.subscriptions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER trg_subscriptions_updated BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- Source migration: 20260310101503_65ea78cb-ea02-4faf-ad4f-55b34244e22c.sql

CREATE TABLE public.billing_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id text NOT NULL UNIQUE,
  event_type text NOT NULL,
  user_id uuid,
  stripe_customer_id text,
  stripe_subscription_id text,
  data jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;

-- Service role can do everything
CREATE POLICY "Service role manages billing_events"
  ON public.billing_events FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Users can read their own billing events
CREATE POLICY "Users can read own billing events"
  ON public.billing_events FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Admins can read all billing events
CREATE POLICY "Admins can read all billing events"
  ON public.billing_events FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));


-- Source migration: 20260310101849_7728c3ba-b18e-458e-8ab2-16f85d97c935.sql

CREATE TABLE public.usage_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  tool_name text NOT NULL,
  executions integer NOT NULL DEFAULT 0,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, tool_name, period_start)
);

ALTER TABLE public.usage_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own usage"
  ON public.usage_metrics FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own usage"
  ON public.usage_metrics FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own usage"
  ON public.usage_metrics FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can read all usage"
  ON public.usage_metrics FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_usage_metrics_updated_at
  BEFORE UPDATE ON public.usage_metrics
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();


-- Source migration: 20260310102231_dcc5b7ef-a7d8-4497-b894-30b32bb79262.sql

-- Agents table: reusable agent definitions
CREATE TABLE public.agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  owner_id uuid NOT NULL,
  tool_sequence text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own agents"
  ON public.agents FOR ALL
  TO authenticated
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

-- Agent runs table: execution records
CREATE TABLE public.agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  case_id uuid REFERENCES public.cases(id) ON DELETE SET NULL,
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  input_data jsonb DEFAULT '{}'::jsonb,
  results jsonb DEFAULT '[]'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own agent runs"
  ON public.agent_runs FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


-- Source migration: 20260310102521_1fa2dfcf-4c43-48d7-bb23-7477786b1f6c.sql

-- Reports metadata table
CREATE TABLE public.reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  report_type text NOT NULL,
  format text NOT NULL,
  file_path text,
  file_size bigint,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own reports"
  ON public.reports FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Reports storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('reports', 'reports', false);

-- Storage RLS: users can manage their own folder
CREATE POLICY "Users can upload reports"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'reports' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can read own reports"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'reports' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can delete own reports"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'reports' AND (storage.foldername(name))[1] = auth.uid()::text);


-- Source migration: 20260310103158_ff7c3812-2452-4ad0-869f-38e02ad0c13c.sql

-- Collaborator role enum
CREATE TYPE public.case_collaborator_role AS ENUM ('viewer', 'investigator', 'legal_reviewer');

-- Collaborators table
CREATE TABLE public.case_collaborators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role case_collaborator_role NOT NULL DEFAULT 'viewer',
  invited_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, user_id)
);

ALTER TABLE public.case_collaborators ENABLE ROW LEVEL SECURITY;

-- Security definer helper: check if user is a collaborator on a case
CREATE OR REPLACE FUNCTION public.is_case_collaborator(_user_id uuid, _case_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.case_collaborators
    WHERE user_id = _user_id AND case_id = _case_id
  )
$$;

-- Security definer helper: check if user is owner of a case
CREATE OR REPLACE FUNCTION public.is_case_owner(_user_id uuid, _case_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.cases
    WHERE id = _case_id AND owner_id = _user_id
  )
$$;

-- Helper: check if user can access a case (owner OR collaborator)
CREATE OR REPLACE FUNCTION public.can_access_case(_user_id uuid, _case_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_case_owner(_user_id, _case_id) OR public.is_case_collaborator(_user_id, _case_id)
$$;

-- RLS for case_collaborators: owners can manage, collaborators can view
CREATE POLICY "Case owners can manage collaborators"
  ON public.case_collaborators FOR ALL
  TO authenticated
  USING (public.is_case_owner(auth.uid(), case_id))
  WITH CHECK (public.is_case_owner(auth.uid(), case_id));

CREATE POLICY "Collaborators can view own membership"
  ON public.case_collaborators FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Update cases RLS: allow collaborators to SELECT
DROP POLICY IF EXISTS "Users can manage own cases" ON public.cases;
CREATE POLICY "Owners can manage own cases"
  ON public.cases FOR ALL
  TO authenticated
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Collaborators can view assigned cases"
  ON public.cases FOR SELECT
  TO authenticated
  USING (public.is_case_collaborator(auth.uid(), id));

-- Update subjects RLS: allow collaborators
DROP POLICY IF EXISTS "Users can manage own subjects" ON public.subjects;
CREATE POLICY "Owners can manage subjects"
  ON public.subjects FOR ALL
  TO authenticated
  USING (public.is_case_owner(auth.uid(), case_id))
  WITH CHECK (public.is_case_owner(auth.uid(), case_id));

CREATE POLICY "Collaborators can view subjects"
  ON public.subjects FOR SELECT
  TO authenticated
  USING (public.is_case_collaborator(auth.uid(), case_id));

-- Investigator collaborators can insert subjects
CREATE POLICY "Investigator collaborators can add subjects"
  ON public.subjects FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.case_collaborators
      WHERE user_id = auth.uid() AND case_id = subjects.case_id AND role = 'investigator'
    )
  );

-- Update artifacts RLS
DROP POLICY IF EXISTS "Users can manage own artifacts" ON public.artifacts;
CREATE POLICY "Owners can manage artifacts"
  ON public.artifacts FOR ALL
  TO authenticated
  USING (public.is_case_owner(auth.uid(), case_id))
  WITH CHECK (public.is_case_owner(auth.uid(), case_id));

CREATE POLICY "Collaborators can view artifacts"
  ON public.artifacts FOR SELECT
  TO authenticated
  USING (public.is_case_collaborator(auth.uid(), case_id));

CREATE POLICY "Investigator collaborators can add artifacts"
  ON public.artifacts FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.case_collaborators
      WHERE user_id = auth.uid() AND case_id = artifacts.case_id AND role = 'investigator'
    )
  );

-- Update events RLS
DROP POLICY IF EXISTS "Users can manage own events" ON public.events;
CREATE POLICY "Owners can manage events"
  ON public.events FOR ALL
  TO authenticated
  USING (public.is_case_owner(auth.uid(), case_id))
  WITH CHECK (public.is_case_owner(auth.uid(), case_id));

CREATE POLICY "Collaborators can view events"
  ON public.events FOR SELECT
  TO authenticated
  USING (public.is_case_collaborator(auth.uid(), case_id));

-- Update evidence_logs RLS: allow collaborators to view
CREATE POLICY "Collaborators can view evidence logs"
  ON public.evidence_logs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.artifacts a
      WHERE a.id = evidence_logs.artifact_id
        AND public.is_case_collaborator(auth.uid(), a.case_id)
    )
  );

-- Update entities RLS
DROP POLICY IF EXISTS "Users can manage own entities" ON public.entities;
CREATE POLICY "Owners can manage entities"
  ON public.entities FOR ALL
  TO authenticated
  USING (public.is_case_owner(auth.uid(), case_id))
  WITH CHECK (public.is_case_owner(auth.uid(), case_id));

CREATE POLICY "Collaborators can view entities"
  ON public.entities FOR SELECT
  TO authenticated
  USING (public.is_case_collaborator(auth.uid(), case_id));

-- Update entity_relationships RLS
DROP POLICY IF EXISTS "Users can manage own relationships" ON public.entity_relationships;
CREATE POLICY "Owners can manage relationships"
  ON public.entity_relationships FOR ALL
  TO authenticated
  USING (public.is_case_owner(auth.uid(), case_id))
  WITH CHECK (public.is_case_owner(auth.uid(), case_id));

CREATE POLICY "Collaborators can view relationships"
  ON public.entity_relationships FOR SELECT
  TO authenticated
  USING (public.is_case_collaborator(auth.uid(), case_id));

-- Update tool_results RLS
DROP POLICY IF EXISTS "Users can manage own tool_results" ON public.tool_results;
CREATE POLICY "Owners can manage tool_results"
  ON public.tool_results FOR ALL
  TO authenticated
  USING (public.is_case_owner(auth.uid(), case_id))
  WITH CHECK (public.is_case_owner(auth.uid(), case_id));

CREATE POLICY "Collaborators can view tool_results"
  ON public.tool_results FOR SELECT
  TO authenticated
  USING (public.is_case_collaborator(auth.uid(), case_id));


-- Source migration: 20260310103359_e7884c2f-1614-4ef8-9f98-4b9794e44291.sql

-- Cross-case correlation table
CREATE TABLE public.cross_case_correlations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  source_case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  source_type text NOT NULL,
  source_value text NOT NULL,
  source_artifact_id uuid REFERENCES public.artifacts(id) ON DELETE SET NULL,
  target_case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  target_type text NOT NULL,
  target_value text NOT NULL,
  target_artifact_id uuid REFERENCES public.artifacts(id) ON DELETE SET NULL,
  relationship_type text NOT NULL,
  confidence numeric NOT NULL DEFAULT 1.0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cross_case_correlations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own correlations"
  ON public.cross_case_correlations FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Index for fast lookups
CREATE INDEX idx_correlations_user ON public.cross_case_correlations(user_id);
CREATE INDEX idx_correlations_source_case ON public.cross_case_correlations(source_case_id);
CREATE INDEX idx_correlations_target_case ON public.cross_case_correlations(target_case_id);


-- Source migration: 20260310103700_2779b502-0f0f-4cc1-96d2-1f1b71817730.sql

-- API keys table
CREATE TABLE public.api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  key text NOT NULL UNIQUE,
  label text NOT NULL DEFAULT 'Default',
  plan text NOT NULL DEFAULT 'free',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own api keys"
  ON public.api_keys FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_api_keys_key ON public.api_keys(key);
CREATE INDEX idx_api_keys_user ON public.api_keys(user_id);

-- API usage table
CREATE TABLE public.api_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key_id uuid NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  method text NOT NULL DEFAULT 'GET',
  status_code integer NOT NULL DEFAULT 200,
  timestamp timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.api_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own api usage"
  ON public.api_usage FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.api_keys ak
    WHERE ak.id = api_usage.key_id AND ak.user_id = auth.uid()
  ));

CREATE POLICY "Service role manages api usage"
  ON public.api_usage FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE INDEX idx_api_usage_key ON public.api_usage(key_id);
CREATE INDEX idx_api_usage_timestamp ON public.api_usage(timestamp);


-- Source migration: 20260310103943_6186037a-49bd-40f0-bc84-31d271a75447.sql

CREATE TABLE public.investigation_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  tool_sequence text[] NOT NULL DEFAULT '{}',
  category text NOT NULL DEFAULT 'general',
  is_system boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.investigation_templates ENABLE ROW LEVEL SECURITY;

-- System templates readable by all authenticated users; custom templates by owner
CREATE POLICY "Anyone can read system templates"
  ON public.investigation_templates FOR SELECT
  TO authenticated
  USING (is_system = true);

CREATE POLICY "Users can manage own templates"
  ON public.investigation_templates FOR ALL
  TO authenticated
  USING (auth.uid() = created_by)
  WITH CHECK (auth.uid() = created_by);


-- Source migration: 20260310104122_7f18104e-0580-45bc-a7b7-61276514bd75.sql

CREATE TABLE public.analysis_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  analysis_type text NOT NULL DEFAULT 'full',
  generated_summary text NOT NULL,
  key_findings jsonb DEFAULT '[]',
  suspicious_patterns jsonb DEFAULT '[]',
  key_relationships jsonb DEFAULT '[]',
  narrative_draft text,
  model_used text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.analysis_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can manage analysis reports"
  ON public.analysis_reports FOR ALL
  TO authenticated
  USING (is_case_owner(auth.uid(), case_id))
  WITH CHECK (is_case_owner(auth.uid(), case_id));

CREATE POLICY "Collaborators can view analysis reports"
  ON public.analysis_reports FOR SELECT
  TO authenticated
  USING (is_case_collaborator(auth.uid(), case_id));

CREATE INDEX idx_analysis_reports_case ON public.analysis_reports(case_id);


-- Source migration: 20260312032711_c2340fa2-839a-4668-85c6-a7fb914165b4.sql

-- Tool marketplace table
CREATE TABLE public.tool_marketplace (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_name text NOT NULL,
  slug text NOT NULL UNIQUE,
  developer_id uuid NOT NULL,
  developer_name text NOT NULL,
  description text,
  long_description text,
  category text NOT NULL DEFAULT 'general',
  pricing_model text NOT NULL DEFAULT 'free',
  min_plan text NOT NULL DEFAULT 'free',
  icon_name text DEFAULT 'Wrench',
  version text NOT NULL DEFAULT '1.0.0',
  downloads integer NOT NULL DEFAULT 0,
  rating numeric DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  tags text[] DEFAULT '{}',
  config_schema jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tool_marketplace ENABLE ROW LEVEL SECURITY;

-- Anyone authed can browse approved tools
CREATE POLICY "Anyone can read approved tools"
  ON public.tool_marketplace FOR SELECT TO authenticated
  USING (status = 'approved');

-- Developers can manage their own tools (all statuses)
CREATE POLICY "Developers can manage own tools"
  ON public.tool_marketplace FOR ALL TO authenticated
  USING (auth.uid() = developer_id)
  WITH CHECK (auth.uid() = developer_id);

-- Admins can manage all tools (for approval workflow)
CREATE POLICY "Admins can manage all marketplace tools"
  ON public.tool_marketplace FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- User installed tools (many-to-many)
CREATE TABLE public.user_installed_tools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  tool_id uuid NOT NULL REFERENCES public.tool_marketplace(id) ON DELETE CASCADE,
  installed_at timestamptz NOT NULL DEFAULT now(),
  enabled boolean NOT NULL DEFAULT true,
  UNIQUE(user_id, tool_id)
);

ALTER TABLE public.user_installed_tools ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own installations"
  ON public.user_installed_tools FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Trigger for updated_at
CREATE TRIGGER update_tool_marketplace_updated_at
  BEFORE UPDATE ON public.tool_marketplace
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- Source migration: 20260312033102_c5447230-8599-419d-9e18-8c1d0ee46b7a.sql

-- Organization role enum
CREATE TYPE public.org_role AS ENUM ('owner', 'admin', 'investigator', 'viewer');

-- Organizations table
CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  owner_id uuid NOT NULL,
  avatar_url text,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

-- Organization members table
CREATE TABLE public.organization_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role org_role NOT NULL DEFAULT 'viewer',
  invited_by uuid,
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, user_id)
);

ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

-- Security definer: check org membership
CREATE OR REPLACE FUNCTION public.is_org_member(_user_id uuid, _org_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE user_id = _user_id AND organization_id = _org_id
  )
$$;

-- Security definer: check org role
CREATE OR REPLACE FUNCTION public.has_org_role(_user_id uuid, _org_id uuid, _role org_role)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE user_id = _user_id AND organization_id = _org_id AND role = _role
  )
$$;

-- Security definer: check org admin (owner or admin)
CREATE OR REPLACE FUNCTION public.is_org_admin(_user_id uuid, _org_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE user_id = _user_id AND organization_id = _org_id AND role IN ('owner', 'admin')
  )
$$;

-- RLS: organizations
CREATE POLICY "Members can view their organizations"
  ON public.organizations FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), id));

CREATE POLICY "Owners can manage organizations"
  ON public.organizations FOR ALL TO authenticated
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

-- RLS: organization_members
CREATE POLICY "Members can view org members"
  ON public.organization_members FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));

CREATE POLICY "Org admins can manage members"
  ON public.organization_members FOR ALL TO authenticated
  USING (public.is_org_admin(auth.uid(), organization_id))
  WITH CHECK (public.is_org_admin(auth.uid(), organization_id));

-- Allow users to view their own membership (for listing orgs)
CREATE POLICY "Users can view own memberships"
  ON public.organization_members FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Add organization_id to cases
ALTER TABLE public.cases ADD COLUMN organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;

-- Update cases RLS: org members can view org cases
CREATE POLICY "Org members can view org cases"
  ON public.cases FOR SELECT TO authenticated
  USING (organization_id IS NOT NULL AND public.is_org_member(auth.uid(), organization_id));

-- Org investigators can create cases under org
CREATE POLICY "Org investigators can create org cases"
  ON public.cases FOR INSERT TO authenticated
  WITH CHECK (
    organization_id IS NULL OR (
      organization_id IS NOT NULL AND (
        public.is_org_admin(auth.uid(), organization_id) OR
        public.has_org_role(auth.uid(), organization_id, 'investigator')
      )
    )
  );

-- Org admins can manage org cases
CREATE POLICY "Org admins can manage org cases"
  ON public.cases FOR ALL TO authenticated
  USING (organization_id IS NOT NULL AND public.is_org_admin(auth.uid(), organization_id))
  WITH CHECK (organization_id IS NOT NULL AND public.is_org_admin(auth.uid(), organization_id));

-- Updated_at trigger
CREATE TRIGGER update_organizations_updated_at
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- Source migration: 20260312033359_e6415784-ba21-4088-ad8c-d0e5bd64221d.sql

CREATE TABLE public.activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  action text NOT NULL,
  entity_type text,
  entity_id text,
  metadata jsonb DEFAULT '{}',
  ip_address text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

-- Users can insert own logs
CREATE POLICY "Users can insert own activity logs"
  ON public.activity_logs FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Users can read own logs
CREATE POLICY "Users can read own activity logs"
  ON public.activity_logs FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Admins can read all logs
CREATE POLICY "Admins can read all activity logs"
  ON public.activity_logs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Create index for common queries
CREATE INDEX idx_activity_logs_user_id ON public.activity_logs(user_id);
CREATE INDEX idx_activity_logs_action ON public.activity_logs(action);
CREATE INDEX idx_activity_logs_created_at ON public.activity_logs(created_at DESC);
CREATE INDEX idx_activity_logs_entity ON public.activity_logs(entity_type, entity_id);


-- Source migration: 20260312033632_d6943cca-d85f-44a3-bb22-efc9b7c2788f.sql

-- Alerts table
CREATE TABLE public.alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  subject_id uuid REFERENCES public.subjects(id) ON DELETE CASCADE,
  alert_type text NOT NULL,
  frequency text NOT NULL DEFAULT 'daily',
  enabled boolean NOT NULL DEFAULT true,
  conditions jsonb DEFAULT '{}',
  last_triggered timestamptz,
  last_checked timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own alerts"
  ON public.alerts FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Alert notifications (history of triggered alerts)
CREATE TABLE public.alert_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id uuid NOT NULL REFERENCES public.alerts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  title text NOT NULL,
  message text,
  severity text NOT NULL DEFAULT 'info',
  read boolean NOT NULL DEFAULT false,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.alert_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own notifications"
  ON public.alert_notifications FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Indexes
CREATE INDEX idx_alerts_user_id ON public.alerts(user_id);
CREATE INDEX idx_alerts_enabled ON public.alerts(enabled, frequency);
CREATE INDEX idx_alert_notifications_user ON public.alert_notifications(user_id, read, created_at DESC);

-- Updated_at trigger
CREATE TRIGGER update_alerts_updated_at
  BEFORE UPDATE ON public.alerts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- Source migration: 20260312033843_f2dbaa68-e133-4333-ac6c-b76f8ba1c47b.sql

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;


-- Source migration: 20260312034027_e042967e-54fa-4fe0-b929-6efc50d89ec2.sql

-- Add user_id to tool_results for standalone saves
ALTER TABLE public.tool_results ADD COLUMN IF NOT EXISTS user_id uuid;

-- Add RLS policy for standalone tool results (no case_id)
CREATE POLICY "Users can manage own standalone tool results"
ON public.tool_results
FOR ALL
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- Add performance indexes
CREATE INDEX IF NOT EXISTS idx_tool_results_user_id ON public.tool_results(user_id);
CREATE INDEX IF NOT EXISTS idx_api_usage_key_timestamp ON public.api_usage(key_id, timestamp);


-- Source migration: 20260326073308_3802f133-c973-4a0c-84bf-ef5869d5ddd0.sql

-- Identity resolution tables
CREATE TABLE public.identity_entities (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  entity_type TEXT NOT NULL,
  entity_value TEXT NOT NULL,
  confidence_score NUMERIC NOT NULL DEFAULT 1.0,
  source_case_id UUID REFERENCES public.cases(id) ON DELETE SET NULL,
  source_tool TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, entity_type, entity_value)
);

CREATE TABLE public.identity_entity_links (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  source_entity_id UUID NOT NULL REFERENCES public.identity_entities(id) ON DELETE CASCADE,
  target_entity_id UUID NOT NULL REFERENCES public.identity_entities(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL,
  confidence_score NUMERIC NOT NULL DEFAULT 0.5,
  evidence TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(source_entity_id, target_entity_id, relationship_type)
);

-- RLS
ALTER TABLE public.identity_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.identity_entity_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own identity entities"
  ON public.identity_entities FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can manage own identity links"
  ON public.identity_entity_links FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Index for fast lookups
CREATE INDEX idx_identity_entities_user_type ON public.identity_entities(user_id, entity_type);
CREATE INDEX idx_identity_entities_value ON public.identity_entities(entity_value);
CREATE INDEX idx_identity_links_source ON public.identity_entity_links(source_entity_id);
CREATE INDEX idx_identity_links_target ON public.identity_entity_links(target_entity_id);


-- Source migration: 20260326073624_e6a4796e-d825-4e9d-bcc9-e36d523b173b.sql

CREATE TABLE public.entity_observations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  entity_id UUID NOT NULL REFERENCES public.identity_entities(id) ON DELETE CASCADE,
  case_id UUID REFERENCES public.cases(id) ON DELETE SET NULL,
  source_tool TEXT,
  observed_value TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.entity_observations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own observations"
  ON public.entity_observations FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_entity_observations_entity ON public.entity_observations(entity_id);
CREATE INDEX idx_entity_observations_case ON public.entity_observations(case_id);
CREATE INDEX idx_entity_observations_user ON public.entity_observations(user_id);


-- Source migration: 20260326073820_83e100d5-417d-462d-ba63-642eaba201a9.sql

CREATE TABLE public.social_graph_edges (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  source_entity_id UUID NOT NULL REFERENCES public.identity_entities(id) ON DELETE CASCADE,
  target_entity_id UUID NOT NULL REFERENCES public.identity_entities(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL,
  confidence_score NUMERIC NOT NULL DEFAULT 0.5,
  source_tool TEXT,
  evidence TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, source_entity_id, target_entity_id, relationship_type)
);

ALTER TABLE public.social_graph_edges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own social graph edges"
  ON public.social_graph_edges FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_social_graph_source ON public.social_graph_edges(source_entity_id);
CREATE INDEX idx_social_graph_target ON public.social_graph_edges(target_entity_id);
CREATE INDEX idx_social_graph_user ON public.social_graph_edges(user_id);


-- Source migration: 20260326074144_f4f11e69-e478-472c-8a06-c30cca563794.sql

CREATE TABLE public.pipelines (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  schedule TEXT NOT NULL DEFAULT 'manual',
  tool_sequence TEXT[] NOT NULL DEFAULT '{}'::text[],
  target_case_id UUID REFERENCES public.cases(id) ON DELETE SET NULL,
  target_entity_ids UUID[] DEFAULT '{}'::uuid[],
  input_params JSONB DEFAULT '{}'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT true,
  last_run_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.pipelines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own pipelines"
  ON public.pipelines FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_pipelines_user ON public.pipelines(user_id);

CREATE TABLE public.pipeline_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  pipeline_id UUID NOT NULL REFERENCES public.pipelines(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  results JSONB DEFAULT '[]'::jsonb,
  errors JSONB DEFAULT '[]'::jsonb,
  artifacts_created INTEGER DEFAULT 0,
  entities_linked INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.pipeline_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own pipeline runs"
  ON public.pipeline_runs FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_pipeline_runs_pipeline ON public.pipeline_runs(pipeline_id);
CREATE INDEX idx_pipeline_runs_user ON public.pipeline_runs(user_id);

CREATE TRIGGER update_pipelines_updated_at
  BEFORE UPDATE ON public.pipelines
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();


-- Source migration: 20260326074431_abfa3a93-c905-4e33-b956-a360cf2d2b5a.sql

CREATE TABLE public.entity_scores (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  entity_id UUID NOT NULL REFERENCES public.identity_entities(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  score NUMERIC NOT NULL DEFAULT 0,
  score_reasons JSONB DEFAULT '[]'::jsonb,
  linked_identifiers INTEGER DEFAULT 0,
  case_appearances INTEGER DEFAULT 0,
  infrastructure_overlap INTEGER DEFAULT 0,
  relationship_density INTEGER DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(entity_id, user_id)
);

ALTER TABLE public.entity_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own entity scores"
  ON public.entity_scores FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_entity_scores_entity ON public.entity_scores(entity_id);
CREATE INDEX idx_entity_scores_user ON public.entity_scores(user_id);
CREATE INDEX idx_entity_scores_score ON public.entity_scores(score DESC);


-- Source migration: 20260326074803_92901880-ffdd-4a89-9033-06f7af04550a.sql

CREATE TABLE public.infrastructure_links (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  entity_id UUID NOT NULL REFERENCES public.identity_entities(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  infrastructure_type TEXT NOT NULL,
  value TEXT NOT NULL,
  confidence_score NUMERIC NOT NULL DEFAULT 0.5,
  source_tool TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(entity_id, infrastructure_type, value)
);

ALTER TABLE public.infrastructure_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own infrastructure links"
  ON public.infrastructure_links FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_infra_links_entity ON public.infrastructure_links(entity_id);
CREATE INDEX idx_infra_links_user ON public.infrastructure_links(user_id);
CREATE INDEX idx_infra_links_type ON public.infrastructure_links(infrastructure_type);
CREATE INDEX idx_infra_links_value ON public.infrastructure_links(value);


-- Source migration: 20260326075242_99a50892-c50f-4e1b-85d7-5db164c6c58e.sql

CREATE TABLE public.breach_records (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  entity_id UUID NOT NULL REFERENCES public.identity_entities(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  breach_source TEXT NOT NULL,
  breach_date DATE,
  data_exposed TEXT[] DEFAULT '{}'::text[],
  severity TEXT NOT NULL DEFAULT 'medium',
  password_reuse_detected BOOLEAN DEFAULT false,
  credential_leaked BOOLEAN DEFAULT false,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(entity_id, breach_source)
);

ALTER TABLE public.breach_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own breach records"
  ON public.breach_records FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_breach_records_entity ON public.breach_records(entity_id);
CREATE INDEX idx_breach_records_user ON public.breach_records(user_id);
CREATE INDEX idx_breach_records_severity ON public.breach_records(severity);
CREATE INDEX idx_breach_records_source ON public.breach_records(breach_source);


-- Source migration: 20260326075549_20dc6798-311f-4e69-b963-6f47e7e4a6b1.sql

CREATE TABLE public.entity_timeline (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  entity_id UUID NOT NULL REFERENCES public.identity_entities(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  event_timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  source TEXT,
  description TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.entity_timeline ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own entity timeline"
  ON public.entity_timeline FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_entity_timeline_entity ON public.entity_timeline(entity_id);
CREATE INDEX idx_entity_timeline_user ON public.entity_timeline(user_id);
CREATE INDEX idx_entity_timeline_timestamp ON public.entity_timeline(event_timestamp);


-- Source migration: 20260326075809_2340e40b-f4dd-4ba3-9f6f-e87211ccffbc.sql

CREATE TABLE public.cross_case_links (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  entity_id UUID NOT NULL REFERENCES public.identity_entities(id) ON DELETE CASCADE,
  case_id UUID NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  linked_case_id UUID NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  link_reason TEXT NOT NULL,
  user_id UUID NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  acknowledged BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(entity_id, case_id, linked_case_id)
);

ALTER TABLE public.cross_case_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own cross case links"
  ON public.cross_case_links FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_cross_case_links_entity ON public.cross_case_links(entity_id);
CREATE INDEX idx_cross_case_links_case ON public.cross_case_links(case_id);
CREATE INDEX idx_cross_case_links_user ON public.cross_case_links(user_id);


-- Source migration: 20260326080035_ad2b896a-6114-4bc9-a5cf-3ff415d855b1.sql

CREATE TABLE public.investigation_suggestions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id UUID NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  trigger_type TEXT NOT NULL,
  trigger_value TEXT NOT NULL,
  recommended_tool TEXT NOT NULL,
  tool_description TEXT,
  confidence_score NUMERIC NOT NULL DEFAULT 0.5,
  dismissed BOOLEAN NOT NULL DEFAULT false,
  executed BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(case_id, trigger_value, recommended_tool)
);

ALTER TABLE public.investigation_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own suggestions"
  ON public.investigation_suggestions FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_investigation_suggestions_case ON public.investigation_suggestions(case_id);
CREATE INDEX idx_investigation_suggestions_user ON public.investigation_suggestions(user_id);


-- Source migration: 20260326080512_16f42c79-c3cd-4561-b163-5dcd0abf3ca8.sql

CREATE TABLE public.entity_monitors (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  entity_id uuid NOT NULL REFERENCES public.identity_entities(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  monitor_type text NOT NULL,
  frequency text NOT NULL DEFAULT 'daily',
  enabled boolean NOT NULL DEFAULT true,
  last_checked timestamp with time zone,
  last_triggered timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.entity_monitors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own monitors"
  ON public.entity_monitors FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_entity_monitors_entity ON public.entity_monitors(entity_id);
CREATE INDEX idx_entity_monitors_user ON public.entity_monitors(user_id);

CREATE TRIGGER update_entity_monitors_updated_at
  BEFORE UPDATE ON public.entity_monitors
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- Source migration: 20260326080924_dd1a3666-ba43-4583-9f6f-4e21786ee933.sql

-- Personas table
CREATE TABLE public.personas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  persona_label text NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.personas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own personas" ON public.personas
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_personas_user_id ON public.personas(user_id);

-- Persona identifiers table
CREATE TABLE public.persona_identifiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id uuid NOT NULL REFERENCES public.personas(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  identifier_type text NOT NULL,
  identifier_value text NOT NULL,
  confidence_score numeric NOT NULL DEFAULT 0.5,
  source text DEFAULT 'generated',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(persona_id, identifier_type, identifier_value)
);

ALTER TABLE public.persona_identifiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own persona identifiers" ON public.persona_identifiers
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_persona_identifiers_persona ON public.persona_identifiers(persona_id);
CREATE INDEX idx_persona_identifiers_value ON public.persona_identifiers(identifier_value);

-- Trigger for updated_at
CREATE TRIGGER update_personas_updated_at
  BEFORE UPDATE ON public.personas
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- Source migration: 20260326081145_8038e16c-f486-418c-8b18-3e685523a362.sql

CREATE TABLE public.username_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id uuid NOT NULL REFERENCES public.personas(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  candidate_username text NOT NULL,
  confidence_score numeric NOT NULL DEFAULT 0.5,
  generation_method text NOT NULL DEFAULT 'pattern',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(persona_id, candidate_username)
);

ALTER TABLE public.username_candidates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own username candidates" ON public.username_candidates
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_username_candidates_persona ON public.username_candidates(persona_id);
CREATE INDEX idx_username_candidates_username ON public.username_candidates(candidate_username);


-- Source migration: 20260326081347_a449ff85-c0c6-4edb-8014-bc1dfd77550c.sql

CREATE TABLE public.email_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id uuid NOT NULL REFERENCES public.personas(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  candidate_email text NOT NULL,
  confidence_score numeric NOT NULL DEFAULT 0.5,
  generation_method text NOT NULL DEFAULT 'pattern',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(persona_id, candidate_email)
);

ALTER TABLE public.email_candidates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own email candidates" ON public.email_candidates
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_email_candidates_persona ON public.email_candidates(persona_id);
CREATE INDEX idx_email_candidates_email ON public.email_candidates(candidate_email);


-- Source migration: 20260326081601_96f602e6-3f4f-45e8-a48a-c5a60bcad984.sql

CREATE TABLE public.identity_clusters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  cluster_label text NOT NULL DEFAULT 'Unnamed Cluster',
  cluster_score numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.identity_clusters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own clusters" ON public.identity_clusters
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_identity_clusters_user ON public.identity_clusters(user_id);

CREATE TABLE public.cluster_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_id uuid NOT NULL REFERENCES public.identity_clusters(id) ON DELETE CASCADE,
  entity_id uuid NOT NULL REFERENCES public.identity_entities(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  confidence_score numeric NOT NULL DEFAULT 0.5,
  join_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(cluster_id, entity_id)
);

ALTER TABLE public.cluster_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own cluster members" ON public.cluster_members
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_cluster_members_cluster ON public.cluster_members(cluster_id);
CREATE INDEX idx_cluster_members_entity ON public.cluster_members(entity_id);

CREATE TRIGGER update_identity_clusters_updated_at
  BEFORE UPDATE ON public.identity_clusters
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- Source migration: 20260326190719_1ccf4f6c-fb43-4806-8206-9b512fe8d772.sql

CREATE TABLE public.similarity_scores (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  entity_a uuid NOT NULL REFERENCES public.identity_entities(id) ON DELETE CASCADE,
  entity_b uuid NOT NULL REFERENCES public.identity_entities(id) ON DELETE CASCADE,
  similarity_score numeric NOT NULL DEFAULT 0,
  analysis_method text NOT NULL DEFAULT 'composite',
  username_similarity numeric DEFAULT 0,
  temporal_similarity numeric DEFAULT 0,
  infrastructure_similarity numeric DEFAULT 0,
  metadata_similarity numeric DEFAULT 0,
  details jsonb DEFAULT '{}'::jsonb,
  user_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(entity_a, entity_b, user_id)
);

ALTER TABLE public.similarity_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own similarity scores"
  ON public.similarity_scores FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_similarity_scores_user ON public.similarity_scores(user_id);
CREATE INDEX idx_similarity_scores_entities ON public.similarity_scores(entity_a, entity_b);
CREATE INDEX idx_similarity_scores_score ON public.similarity_scores(similarity_score DESC);


-- Source migration: 20260326191247_03795c58-ea2d-4dcf-9ce3-e1081ccb8f29.sql

CREATE TABLE public.expansion_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  trigger_entity_id uuid REFERENCES public.identity_entities(id) ON DELETE SET NULL,
  trigger_value text NOT NULL,
  trigger_type text NOT NULL,
  step text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  result jsonb DEFAULT '{}'::jsonb,
  error text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.expansion_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own expansion logs"
  ON public.expansion_logs FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_expansion_logs_user ON public.expansion_logs(user_id);
CREATE INDEX idx_expansion_logs_entity ON public.expansion_logs(trigger_entity_id);
CREATE INDEX idx_expansion_logs_created ON public.expansion_logs(created_at DESC);


-- Source migration: 20260326191550_66da2500-907d-475d-a28a-6f8e003ebe01.sql

CREATE TABLE public.persona_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  persona_id uuid NOT NULL REFERENCES public.personas(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  event_type text NOT NULL,
  event_label text NOT NULL DEFAULT '',
  event_timestamp timestamp with time zone NOT NULL DEFAULT now(),
  source text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.persona_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own persona events"
  ON public.persona_events FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_persona_events_persona ON public.persona_events(persona_id);
CREATE INDEX idx_persona_events_user ON public.persona_events(user_id);
CREATE INDEX idx_persona_events_timestamp ON public.persona_events(event_timestamp DESC);


-- Source migration: 20260326191831_022eea7b-766e-40de-af50-d25c74831932.sql

CREATE TABLE public.platform_accounts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  persona_id uuid NOT NULL REFERENCES public.personas(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  platform_name text NOT NULL,
  platform_category text NOT NULL DEFAULT 'other',
  account_identifier text NOT NULL,
  profile_url text,
  confidence_score numeric NOT NULL DEFAULT 0.5,
  metadata jsonb DEFAULT '{}'::jsonb,
  verified boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(persona_id, platform_name, account_identifier)
);

ALTER TABLE public.platform_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own platform accounts"
  ON public.platform_accounts FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_platform_accounts_persona ON public.platform_accounts(persona_id);
CREATE INDEX idx_platform_accounts_user ON public.platform_accounts(user_id);
CREATE INDEX idx_platform_accounts_platform ON public.platform_accounts(platform_name);


-- Source migration: 20260508230641_9bd4aa27-8806-4331-8e39-2303b3510e4d.sql
CREATE TABLE public.pdl_lookups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  lookup_type text NOT NULL CHECK (lookup_type IN ('person-enrich','person-search','company-enrich')),
  label text NOT NULL DEFAULT '',
  inputs jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pdl_lookups_user_created ON public.pdl_lookups (user_id, created_at DESC);

ALTER TABLE public.pdl_lookups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own pdl lookups"
  ON public.pdl_lookups FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own pdl lookups"
  ON public.pdl_lookups FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own pdl lookups"
  ON public.pdl_lookups FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- Source migration: 20260508231625_59130861-ce5b-4ef2-abee-79f05cd74774.sql
-- Tool permissions: admins can deny specific tools per user.
-- Default: if no row exists for (user, tool), the tool is allowed.
CREATE TABLE public.tool_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  tool_id text NOT NULL,
  allowed boolean NOT NULL DEFAULT true,
  updated_by uuid,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id, tool_id)
);

CREATE INDEX idx_tool_permissions_user ON public.tool_permissions(user_id);

ALTER TABLE public.tool_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage tool permissions"
  ON public.tool_permissions
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users view own tool permissions"
  ON public.tool_permissions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER trg_tool_permissions_updated_at
  BEFORE UPDATE ON public.tool_permissions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Source migration: 20260515055007_25f05acf-4041-40f1-8229-5438c6d46ec3.sql
-- Pre-launch wipe of fabricated OSINT data from simulated pipeline runs.
-- Real dispatcher ships in this same deploy.
DELETE FROM public.entity_observations;
DELETE FROM public.breach_records;
DELETE FROM public.identity_entities;
DELETE FROM public.tool_results;

-- breach_records: add real-API columns (no-op if already exist)
ALTER TABLE public.breach_records
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS identifier text,
  ADD COLUMN IF NOT EXISTS breach_name text,
  ADD COLUMN IF NOT EXISTS data_classes jsonb,
  ADD COLUMN IF NOT EXISTS raw_response jsonb;

-- Allow non-exposure / not_configured rows that aren't tied to a specific entity
ALTER TABLE public.breach_records ALTER COLUMN entity_id DROP NOT NULL;
ALTER TABLE public.breach_records ALTER COLUMN breach_source DROP NOT NULL;

-- Old uniqueness was (entity_id, breach_source); drop so identifier-scoped rows don't conflict
ALTER TABLE public.breach_records DROP CONSTRAINT IF EXISTS breach_records_entity_id_breach_source_key;

-- tool_results: status column for honest provenance
ALTER TABLE public.tool_results
  ADD COLUMN IF NOT EXISTS status text;

-- Source migration: 20260527005954_96c1f98d-d2cf-4b73-aa51-02d6fffd80b0.sql
DELETE FROM public.entity_timeline
WHERE source IN (
  'OSINT scan','Breach database','Platform enumeration','Dark web monitoring',
  'Username enumeration','Platform scan','Social media crawl','Web scraper',
  'WHOIS lookup','DNS history','Certificate transparency','Passive DNS',
  'Phone lookup','Carrier OSINT','App enumeration','IP intelligence',
  'Shodan','Abuse DB','Geo-IP service','Profile monitor','API enumeration'
);

-- Source migration: 20260527011341_74f80d73-eb21-41a5-81ec-607e87cea74a.sql

CREATE TABLE public.organization_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email text NOT NULL,
  role public.org_role NOT NULL DEFAULT 'investigator',
  token text NOT NULL UNIQUE,
  invited_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at timestamptz
);

CREATE INDEX idx_org_invitations_org ON public.organization_invitations(organization_id);
CREATE INDEX idx_org_invitations_token ON public.organization_invitations(token);

GRANT SELECT ON public.organization_invitations TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_invitations TO authenticated;
GRANT ALL ON public.organization_invitations TO service_role;

ALTER TABLE public.organization_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org admins view invitations"
  ON public.organization_invitations FOR SELECT TO authenticated
  USING (public.is_org_admin(auth.uid(), organization_id));

CREATE POLICY "Public can lookup by token"
  ON public.organization_invitations FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY "Org admins create invitations"
  ON public.organization_invitations FOR INSERT TO authenticated
  WITH CHECK (public.is_org_admin(auth.uid(), organization_id) AND invited_by = auth.uid());

CREATE POLICY "Org admins delete invitations"
  ON public.organization_invitations FOR DELETE TO authenticated
  USING (public.is_org_admin(auth.uid(), organization_id));

CREATE POLICY "Org admins update invitations"
  ON public.organization_invitations FOR UPDATE TO authenticated
  USING (public.is_org_admin(auth.uid(), organization_id));

COMMIT;
