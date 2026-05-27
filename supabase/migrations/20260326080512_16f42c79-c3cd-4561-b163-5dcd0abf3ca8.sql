
CREATE TABLE public.entity_monitors (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  entity_id uuid NOT NULL REFERENCES public.identity_entities(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  monitor_type text NOT NULL,
  frequency text NOT NULL DEFAULT 'daily',
  enabled boolean NOT NULL DEFAULT true,
  last_checked timestamp with time zone,
  last_triggered timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.entity_monitors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own monitors"
  ON public.entity_monitors FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_entity_monitors_entity ON public.entity_monitors(entity_id);
CREATE INDEX idx_entity_monitors_user ON public.entity_monitors(user_id);

CREATE TRIGGER update_entity_monitors_updated_at
  BEFORE UPDATE ON public.entity_monitors
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
