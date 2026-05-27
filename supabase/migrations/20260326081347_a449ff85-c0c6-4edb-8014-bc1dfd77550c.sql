
CREATE TABLE public.email_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id uuid NOT NULL REFERENCES public.personas(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  candidate_email text NOT NULL,
  confidence_score numeric NOT NULL DEFAULT 0.5,
  generation_method text NOT NULL DEFAULT 'pattern',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(persona_id, candidate_email)
);

ALTER TABLE public.email_candidates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own email candidates" ON public.email_candidates
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_email_candidates_persona ON public.email_candidates(persona_id);
CREATE INDEX idx_email_candidates_email ON public.email_candidates(candidate_email);
