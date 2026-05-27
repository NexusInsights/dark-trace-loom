
CREATE TABLE public.expansion_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  trigger_entity_id uuid REFERENCES public.identity_entities(id) ON DELETE SET NULL,
  trigger_value text NOT NULL,
  trigger_type text NOT NULL,
  step text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  result jsonb DEFAULT '{}'::jsonb,
  error text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.expansion_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own expansion logs"
  ON public.expansion_logs FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_expansion_logs_user ON public.expansion_logs(user_id);
CREATE INDEX idx_expansion_logs_entity ON public.expansion_logs(trigger_entity_id);
CREATE INDEX idx_expansion_logs_created ON public.expansion_logs(created_at DESC);
