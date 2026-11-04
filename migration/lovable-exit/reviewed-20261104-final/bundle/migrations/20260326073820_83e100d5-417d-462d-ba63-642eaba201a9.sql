
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
