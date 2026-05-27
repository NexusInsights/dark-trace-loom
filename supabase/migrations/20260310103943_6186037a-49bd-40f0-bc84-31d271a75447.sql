
CREATE TABLE public.investigation_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  tool_sequence text[] NOT NULL DEFAULT '{}',
  category text NOT NULL DEFAULT 'general',
  is_system boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.investigation_templates ENABLE ROW LEVEL SECURITY;

-- System templates readable by all authenticated users; custom templates by owner
CREATE POLICY "Anyone can read system templates"
  ON public.investigation_templates FOR SELECT
  TO authenticated
  USING (is_system = true);

CREATE POLICY "Users can manage own templates"
  ON public.investigation_templates FOR ALL
  TO authenticated
  USING (auth.uid() = created_by)
  WITH CHECK (auth.uid() = created_by);
