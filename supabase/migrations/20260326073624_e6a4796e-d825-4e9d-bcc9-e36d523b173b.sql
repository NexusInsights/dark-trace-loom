
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
