
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
