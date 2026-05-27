
CREATE TABLE public.entity_timeline (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  entity_id UUID NOT NULL REFERENCES public.identity_entities(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  event_timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  source TEXT,
  description TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.entity_timeline ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own entity timeline"
  ON public.entity_timeline FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_entity_timeline_entity ON public.entity_timeline(entity_id);
CREATE INDEX idx_entity_timeline_user ON public.entity_timeline(user_id);
CREATE INDEX idx_entity_timeline_timestamp ON public.entity_timeline(event_timestamp);
