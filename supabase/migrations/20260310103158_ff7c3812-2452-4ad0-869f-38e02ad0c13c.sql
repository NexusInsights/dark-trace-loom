
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
