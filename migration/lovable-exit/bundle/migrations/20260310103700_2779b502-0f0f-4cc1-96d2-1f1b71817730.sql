
-- API keys table
CREATE TABLE public.api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  key text NOT NULL UNIQUE,
  label text NOT NULL DEFAULT 'Default',
  plan text NOT NULL DEFAULT 'free',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own api keys"
  ON public.api_keys FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_api_keys_key ON public.api_keys(key);
CREATE INDEX idx_api_keys_user ON public.api_keys(user_id);

-- API usage table
CREATE TABLE public.api_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key_id uuid NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  method text NOT NULL DEFAULT 'GET',
  status_code integer NOT NULL DEFAULT 200,
  timestamp timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.api_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own api usage"
  ON public.api_usage FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.api_keys ak
    WHERE ak.id = api_usage.key_id AND ak.user_id = auth.uid()
  ));

CREATE POLICY "Service role manages api usage"
  ON public.api_usage FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE INDEX idx_api_usage_key ON public.api_usage(key_id);
CREATE INDEX idx_api_usage_timestamp ON public.api_usage(timestamp);
