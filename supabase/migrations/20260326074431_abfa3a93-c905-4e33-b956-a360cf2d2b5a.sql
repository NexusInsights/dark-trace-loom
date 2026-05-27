
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
