
-- Replace the insert trigger with a clean version
CREATE OR REPLACE FUNCTION public.log_artifact_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_id uuid;
BEGIN
  SELECT owner_id INTO v_owner_id FROM public.cases WHERE id = NEW.case_id;
  INSERT INTO public.evidence_logs (artifact_id, action, user_id, hash)
  VALUES (
    NEW.id,
    'created',
    v_owner_id,
    md5(COALESCE(NEW.data, '') || NEW.artifact_type || NEW.id::text || now()::text)
  );
  RETURN NEW;
END;
$$;
