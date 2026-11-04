
CREATE TABLE public.organization_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email text NOT NULL,
  role public.org_role NOT NULL DEFAULT 'investigator',
  token text NOT NULL UNIQUE,
  invited_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at timestamptz
);

CREATE INDEX idx_org_invitations_org ON public.organization_invitations(organization_id);
CREATE INDEX idx_org_invitations_token ON public.organization_invitations(token);

GRANT SELECT ON public.organization_invitations TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_invitations TO authenticated;
GRANT ALL ON public.organization_invitations TO service_role;

ALTER TABLE public.organization_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org admins view invitations"
  ON public.organization_invitations FOR SELECT TO authenticated
  USING (public.is_org_admin(auth.uid(), organization_id));

CREATE POLICY "Public can lookup by token"
  ON public.organization_invitations FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY "Org admins create invitations"
  ON public.organization_invitations FOR INSERT TO authenticated
  WITH CHECK (public.is_org_admin(auth.uid(), organization_id) AND invited_by = auth.uid());

CREATE POLICY "Org admins delete invitations"
  ON public.organization_invitations FOR DELETE TO authenticated
  USING (public.is_org_admin(auth.uid(), organization_id));

CREATE POLICY "Org admins update invitations"
  ON public.organization_invitations FOR UPDATE TO authenticated
  USING (public.is_org_admin(auth.uid(), organization_id));
