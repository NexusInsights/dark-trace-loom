
CREATE TABLE public.evidence_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id uuid NOT NULL REFERENCES public.artifacts(id) ON DELETE CASCADE,
  action text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  timestamp timestamptz NOT NULL DEFAULT now(),
  hash text NOT NULL
);

ALTER TABLE public.evidence_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view logs for own artifacts"
ON public.evidence_logs FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.artifacts a
    JOIN public.cases c ON c.id = a.case_id
    WHERE a.id = evidence_logs.artifact_id AND c.owner_id = auth.uid()
  )
);

CREATE POLICY "Users can insert own logs"
ON public.evidence_logs FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

-- Auto-log on artifact insert
CREATE OR REPLACE FUNCTION public.log_artifact_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.evidence_logs (artifact_id, action, user_id, hash)
  VALUES (
    NEW.id,
    'created',
    NEW.case_id::uuid, -- placeholder, replaced below
    md5(COALESCE(NEW.data, '') || NEW.artifact_type || NEW.id::text || now()::text)
  );
  -- fix user_id: derive from case owner
  UPDATE public.evidence_logs
  SET user_id = (SELECT owner_id FROM public.cases WHERE id = NEW.case_id)
  WHERE artifact_id = NEW.id AND action = 'created' AND user_id = NEW.case_id;
  RETURN NEW;
END;
$$;

-- Auto-log on artifact update
CREATE OR REPLACE FUNCTION public.log_artifact_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.evidence_logs (artifact_id, action, user_id, hash)
  VALUES (
    NEW.id,
    'modified',
    (SELECT owner_id FROM public.cases WHERE id = NEW.case_id),
    md5(COALESCE(NEW.data, '') || NEW.artifact_type || NEW.id::text || now()::text)
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_artifact_insert_log
  AFTER INSERT ON public.artifacts
  FOR EACH ROW EXECUTE FUNCTION public.log_artifact_insert();

CREATE TRIGGER trg_artifact_update_log
  AFTER UPDATE ON public.artifacts
  FOR EACH ROW EXECUTE FUNCTION public.log_artifact_update();

ALTER PUBLICATION supabase_realtime ADD TABLE public.evidence_logs;
