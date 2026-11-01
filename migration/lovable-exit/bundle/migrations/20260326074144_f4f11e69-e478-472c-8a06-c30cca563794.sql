
CREATE TABLE public.pipelines (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  schedule TEXT NOT NULL DEFAULT 'manual',
  tool_sequence TEXT[] NOT NULL DEFAULT '{}'::text[],
  target_case_id UUID REFERENCES public.cases(id) ON DELETE SET NULL,
  target_entity_ids UUID[] DEFAULT '{}'::uuid[],
  input_params JSONB DEFAULT '{}'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT true,
  last_run_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.pipelines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own pipelines"
  ON public.pipelines FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_pipelines_user ON public.pipelines(user_id);

CREATE TABLE public.pipeline_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  pipeline_id UUID NOT NULL REFERENCES public.pipelines(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  results JSONB DEFAULT '[]'::jsonb,
  errors JSONB DEFAULT '[]'::jsonb,
  artifacts_created INTEGER DEFAULT 0,
  entities_linked INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.pipeline_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own pipeline runs"
  ON public.pipeline_runs FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_pipeline_runs_pipeline ON public.pipeline_runs(pipeline_id);
CREATE INDEX idx_pipeline_runs_user ON public.pipeline_runs(user_id);

CREATE TRIGGER update_pipelines_updated_at
  BEFORE UPDATE ON public.pipelines
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
