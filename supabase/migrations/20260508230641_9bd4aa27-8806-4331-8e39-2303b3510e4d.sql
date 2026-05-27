CREATE TABLE public.pdl_lookups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  lookup_type text NOT NULL CHECK (lookup_type IN ('person-enrich','person-search','company-enrich')),
  label text NOT NULL DEFAULT '',
  inputs jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pdl_lookups_user_created ON public.pdl_lookups (user_id, created_at DESC);

ALTER TABLE public.pdl_lookups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own pdl lookups"
  ON public.pdl_lookups FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own pdl lookups"
  ON public.pdl_lookups FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own pdl lookups"
  ON public.pdl_lookups FOR DELETE TO authenticated
  USING (auth.uid() = user_id);