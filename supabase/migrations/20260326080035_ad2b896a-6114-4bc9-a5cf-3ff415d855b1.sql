
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
