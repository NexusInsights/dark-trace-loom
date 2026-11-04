
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
