
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
