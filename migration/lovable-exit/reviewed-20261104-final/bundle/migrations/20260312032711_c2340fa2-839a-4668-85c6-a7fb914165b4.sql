
-- Tool marketplace table
CREATE TABLE public.tool_marketplace (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_name text NOT NULL,
  slug text NOT NULL UNIQUE,
  developer_id uuid NOT NULL,
  developer_name text NOT NULL,
  description text,
  long_description text,
  category text NOT NULL DEFAULT 'general',
  pricing_model text NOT NULL DEFAULT 'free',
  min_plan text NOT NULL DEFAULT 'free',
  icon_name text DEFAULT 'Wrench',
  version text NOT NULL DEFAULT '1.0.0',
  downloads integer NOT NULL DEFAULT 0,
  rating numeric DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  tags text[] DEFAULT '{}',
  config_schema jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tool_marketplace ENABLE ROW LEVEL SECURITY;

-- Anyone authed can browse approved tools
CREATE POLICY "Anyone can read approved tools"
  ON public.tool_marketplace FOR SELECT TO authenticated
  USING (status = 'approved');

-- Developers can manage their own tools (all statuses)
CREATE POLICY "Developers can manage own tools"
  ON public.tool_marketplace FOR ALL TO authenticated
  USING (auth.uid() = developer_id)
  WITH CHECK (auth.uid() = developer_id);

-- Admins can manage all tools (for approval workflow)
CREATE POLICY "Admins can manage all marketplace tools"
  ON public.tool_marketplace FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- User installed tools (many-to-many)
CREATE TABLE public.user_installed_tools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  tool_id uuid NOT NULL REFERENCES public.tool_marketplace(id) ON DELETE CASCADE,
  installed_at timestamptz NOT NULL DEFAULT now(),
  enabled boolean NOT NULL DEFAULT true,
  UNIQUE(user_id, tool_id)
);

ALTER TABLE public.user_installed_tools ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own installations"
  ON public.user_installed_tools FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Trigger for updated_at
CREATE TRIGGER update_tool_marketplace_updated_at
  BEFORE UPDATE ON public.tool_marketplace
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
