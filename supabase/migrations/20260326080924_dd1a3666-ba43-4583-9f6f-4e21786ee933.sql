
-- Personas table
CREATE TABLE public.personas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  persona_label text NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.personas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own personas" ON public.personas
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_personas_user_id ON public.personas(user_id);

-- Persona identifiers table
CREATE TABLE public.persona_identifiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id uuid NOT NULL REFERENCES public.personas(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  identifier_type text NOT NULL,
  identifier_value text NOT NULL,
  confidence_score numeric NOT NULL DEFAULT 0.5,
  source text DEFAULT 'generated',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(persona_id, identifier_type, identifier_value)
);

ALTER TABLE public.persona_identifiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own persona identifiers" ON public.persona_identifiers
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_persona_identifiers_persona ON public.persona_identifiers(persona_id);
CREATE INDEX idx_persona_identifiers_value ON public.persona_identifiers(identifier_value);

-- Trigger for updated_at
CREATE TRIGGER update_personas_updated_at
  BEFORE UPDATE ON public.personas
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
