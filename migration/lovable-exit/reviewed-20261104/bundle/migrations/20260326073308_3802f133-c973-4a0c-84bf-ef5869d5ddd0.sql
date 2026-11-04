
-- Identity resolution tables
CREATE TABLE public.identity_entities (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  entity_type TEXT NOT NULL,
  entity_value TEXT NOT NULL,
  confidence_score NUMERIC NOT NULL DEFAULT 1.0,
  source_case_id UUID REFERENCES public.cases(id) ON DELETE SET NULL,
  source_tool TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, entity_type, entity_value)
);

CREATE TABLE public.identity_entity_links (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  source_entity_id UUID NOT NULL REFERENCES public.identity_entities(id) ON DELETE CASCADE,
  target_entity_id UUID NOT NULL REFERENCES public.identity_entities(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL,
  confidence_score NUMERIC NOT NULL DEFAULT 0.5,
  evidence TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(source_entity_id, target_entity_id, relationship_type)
);

-- RLS
ALTER TABLE public.identity_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.identity_entity_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own identity entities"
  ON public.identity_entities FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can manage own identity links"
  ON public.identity_entity_links FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Index for fast lookups
CREATE INDEX idx_identity_entities_user_type ON public.identity_entities(user_id, entity_type);
CREATE INDEX idx_identity_entities_value ON public.identity_entities(entity_value);
CREATE INDEX idx_identity_links_source ON public.identity_entity_links(source_entity_id);
CREATE INDEX idx_identity_links_target ON public.identity_entity_links(target_entity_id);
