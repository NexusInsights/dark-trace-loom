
-- Entities: nodes in the graph (subjects, emails, domains, usernames, IPs)
CREATE TABLE public.entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  entity_type text NOT NULL, -- 'subject','email','domain','username','ip'
  label text NOT NULL,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.entities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own entities" ON public.entities FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.cases WHERE cases.id = entities.case_id AND cases.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.cases WHERE cases.id = entities.case_id AND cases.owner_id = auth.uid()));

-- Relationships: edges between entities
CREATE TABLE public.entity_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  target_id uuid NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  relationship_type text NOT NULL, -- 'owns','uses','resolves_to','linked','communicates'
  confidence numeric DEFAULT 1.0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.entity_relationships ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own relationships" ON public.entity_relationships FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.cases WHERE cases.id = entity_relationships.case_id AND cases.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.cases WHERE cases.id = entity_relationships.case_id AND cases.owner_id = auth.uid()));

ALTER PUBLICATION supabase_realtime ADD TABLE public.entities;
ALTER PUBLICATION supabase_realtime ADD TABLE public.entity_relationships;
