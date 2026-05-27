-- Tool permissions: admins can deny specific tools per user.
-- Default: if no row exists for (user, tool), the tool is allowed.
CREATE TABLE public.tool_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  tool_id text NOT NULL,
  allowed boolean NOT NULL DEFAULT true,
  updated_by uuid,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id, tool_id)
);

CREATE INDEX idx_tool_permissions_user ON public.tool_permissions(user_id);

ALTER TABLE public.tool_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage tool permissions"
  ON public.tool_permissions
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users view own tool permissions"
  ON public.tool_permissions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER trg_tool_permissions_updated_at
  BEFORE UPDATE ON public.tool_permissions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();