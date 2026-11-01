
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
