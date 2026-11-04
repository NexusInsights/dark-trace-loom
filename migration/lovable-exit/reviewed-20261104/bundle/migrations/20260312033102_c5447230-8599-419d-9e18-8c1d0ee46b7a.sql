
-- Organization role enum
CREATE TYPE public.org_role AS ENUM ('owner', 'admin', 'investigator', 'viewer');

-- Organizations table
CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  owner_id uuid NOT NULL,
  avatar_url text,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

-- Organization members table
CREATE TABLE public.organization_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role org_role NOT NULL DEFAULT 'viewer',
  invited_by uuid,
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, user_id)
);

ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

-- Security definer: check org membership
CREATE OR REPLACE FUNCTION public.is_org_member(_user_id uuid, _org_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE user_id = _user_id AND organization_id = _org_id
  )
$$;

-- Security definer: check org role
CREATE OR REPLACE FUNCTION public.has_org_role(_user_id uuid, _org_id uuid, _role org_role)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE user_id = _user_id AND organization_id = _org_id AND role = _role
  )
$$;

-- Security definer: check org admin (owner or admin)
CREATE OR REPLACE FUNCTION public.is_org_admin(_user_id uuid, _org_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE user_id = _user_id AND organization_id = _org_id AND role IN ('owner', 'admin')
  )
$$;

-- RLS: organizations
CREATE POLICY "Members can view their organizations"
  ON public.organizations FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), id));

CREATE POLICY "Owners can manage organizations"
  ON public.organizations FOR ALL TO authenticated
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

-- RLS: organization_members
CREATE POLICY "Members can view org members"
  ON public.organization_members FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));

CREATE POLICY "Org admins can manage members"
  ON public.organization_members FOR ALL TO authenticated
  USING (public.is_org_admin(auth.uid(), organization_id))
  WITH CHECK (public.is_org_admin(auth.uid(), organization_id));

-- Allow users to view their own membership (for listing orgs)
CREATE POLICY "Users can view own memberships"
  ON public.organization_members FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Add organization_id to cases
ALTER TABLE public.cases ADD COLUMN organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;

-- Update cases RLS: org members can view org cases
CREATE POLICY "Org members can view org cases"
  ON public.cases FOR SELECT TO authenticated
  USING (organization_id IS NOT NULL AND public.is_org_member(auth.uid(), organization_id));

-- Org investigators can create cases under org
CREATE POLICY "Org investigators can create org cases"
  ON public.cases FOR INSERT TO authenticated
  WITH CHECK (
    organization_id IS NULL OR (
      organization_id IS NOT NULL AND (
        public.is_org_admin(auth.uid(), organization_id) OR
        public.has_org_role(auth.uid(), organization_id, 'investigator')
      )
    )
  );

-- Org admins can manage org cases
CREATE POLICY "Org admins can manage org cases"
  ON public.cases FOR ALL TO authenticated
  USING (organization_id IS NOT NULL AND public.is_org_admin(auth.uid(), organization_id))
  WITH CHECK (organization_id IS NOT NULL AND public.is_org_admin(auth.uid(), organization_id));

-- Updated_at trigger
CREATE TRIGGER update_organizations_updated_at
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
