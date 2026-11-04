
CREATE TABLE public.cross_case_links (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  entity_id UUID NOT NULL REFERENCES public.identity_entities(id) ON DELETE CASCADE,
  case_id UUID NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  linked_case_id UUID NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  link_reason TEXT NOT NULL,
  user_id UUID NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  acknowledged BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(entity_id, case_id, linked_case_id)
);

ALTER TABLE public.cross_case_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own cross case links"
  ON public.cross_case_links FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_cross_case_links_entity ON public.cross_case_links(entity_id);
CREATE INDEX idx_cross_case_links_case ON public.cross_case_links(case_id);
CREATE INDEX idx_cross_case_links_user ON public.cross_case_links(user_id);
