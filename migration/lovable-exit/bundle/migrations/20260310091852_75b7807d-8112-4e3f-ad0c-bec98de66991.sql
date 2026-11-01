
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
