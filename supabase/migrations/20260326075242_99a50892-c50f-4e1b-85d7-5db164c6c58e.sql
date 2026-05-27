
CREATE TABLE public.breach_records (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  entity_id UUID NOT NULL REFERENCES public.identity_entities(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  breach_source TEXT NOT NULL,
  breach_date DATE,
  data_exposed TEXT[] DEFAULT '{}'::text[],
  severity TEXT NOT NULL DEFAULT 'medium',
  password_reuse_detected BOOLEAN DEFAULT false,
  credential_leaked BOOLEAN DEFAULT false,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(entity_id, breach_source)
);

ALTER TABLE public.breach_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own breach records"
  ON public.breach_records FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_breach_records_entity ON public.breach_records(entity_id);
CREATE INDEX idx_breach_records_user ON public.breach_records(user_id);
CREATE INDEX idx_breach_records_severity ON public.breach_records(severity);
CREATE INDEX idx_breach_records_source ON public.breach_records(breach_source);
