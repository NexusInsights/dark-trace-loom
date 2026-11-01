
CREATE TABLE public.billing_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id text NOT NULL UNIQUE,
  event_type text NOT NULL,
  user_id uuid,
  stripe_customer_id text,
  stripe_subscription_id text,
  data jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;

-- Service role can do everything
CREATE POLICY "Service role manages billing_events"
  ON public.billing_events FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Users can read their own billing events
CREATE POLICY "Users can read own billing events"
  ON public.billing_events FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Admins can read all billing events
CREATE POLICY "Admins can read all billing events"
  ON public.billing_events FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));
