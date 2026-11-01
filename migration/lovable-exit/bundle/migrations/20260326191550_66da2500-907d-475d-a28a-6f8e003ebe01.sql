
CREATE TABLE public.persona_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  persona_id uuid NOT NULL REFERENCES public.personas(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  event_type text NOT NULL,
  event_label text NOT NULL DEFAULT '',
  event_timestamp timestamp with time zone NOT NULL DEFAULT now(),
  source text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.persona_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own persona events"
  ON public.persona_events FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_persona_events_persona ON public.persona_events(persona_id);
CREATE INDEX idx_persona_events_user ON public.persona_events(user_id);
CREATE INDEX idx_persona_events_timestamp ON public.persona_events(event_timestamp DESC);
