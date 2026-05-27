
CREATE TABLE public.platform_accounts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  persona_id uuid NOT NULL REFERENCES public.personas(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  platform_name text NOT NULL,
  platform_category text NOT NULL DEFAULT 'other',
  account_identifier text NOT NULL,
  profile_url text,
  confidence_score numeric NOT NULL DEFAULT 0.5,
  metadata jsonb DEFAULT '{}'::jsonb,
  verified boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(persona_id, platform_name, account_identifier)
);

ALTER TABLE public.platform_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own platform accounts"
  ON public.platform_accounts FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_platform_accounts_persona ON public.platform_accounts(persona_id);
CREATE INDEX idx_platform_accounts_user ON public.platform_accounts(user_id);
CREATE INDEX idx_platform_accounts_platform ON public.platform_accounts(platform_name);
