
CREATE TABLE public.username_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id uuid NOT NULL REFERENCES public.personas(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  candidate_username text NOT NULL,
  confidence_score numeric NOT NULL DEFAULT 0.5,
  generation_method text NOT NULL DEFAULT 'pattern',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(persona_id, candidate_username)
);

ALTER TABLE public.username_candidates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own username candidates" ON public.username_candidates
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_username_candidates_persona ON public.username_candidates(persona_id);
CREATE INDEX idx_username_candidates_username ON public.username_candidates(candidate_username);
