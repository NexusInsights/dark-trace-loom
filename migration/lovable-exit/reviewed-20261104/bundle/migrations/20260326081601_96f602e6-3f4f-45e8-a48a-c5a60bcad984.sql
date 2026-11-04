
CREATE TABLE public.identity_clusters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  cluster_label text NOT NULL DEFAULT 'Unnamed Cluster',
  cluster_score numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.identity_clusters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own clusters" ON public.identity_clusters
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_identity_clusters_user ON public.identity_clusters(user_id);

CREATE TABLE public.cluster_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_id uuid NOT NULL REFERENCES public.identity_clusters(id) ON DELETE CASCADE,
  entity_id uuid NOT NULL REFERENCES public.identity_entities(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  confidence_score numeric NOT NULL DEFAULT 0.5,
  join_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(cluster_id, entity_id)
);

ALTER TABLE public.cluster_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own cluster members" ON public.cluster_members
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_cluster_members_cluster ON public.cluster_members(cluster_id);
CREATE INDEX idx_cluster_members_entity ON public.cluster_members(entity_id);

CREATE TRIGGER update_identity_clusters_updated_at
  BEFORE UPDATE ON public.identity_clusters
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
