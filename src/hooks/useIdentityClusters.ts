import { checkedDatabase } from "@/lib/checkedDatabase";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { runIdentityClustering } from "@/lib/clusteringEngine";
import { filterCurrentIdentityEntities } from "@/lib/identityEvidence";
import { loadIdentitySourceRecords } from "@/lib/loadIdentityEvidence";
import { isReviewedMembership, visibleReviewedClusters } from "@/lib/reviewedIdentityGroups";
import { useState } from "react";

async function loadReviewedGroups(userId: string) {
  const [{ data: clusters }, { data: members }, { data: entities }, records] = await Promise.all([
    checkedDatabase(supabase.from("identity_clusters").select("*").eq("user_id", userId).order("created_at", { ascending: false })),
    checkedDatabase(supabase.from("cluster_members").select("*").eq("user_id", userId)),
    checkedDatabase(supabase.from("identity_entities").select("*").eq("user_id", userId)),
    loadIdentitySourceRecords(userId),
  ]);
  const admitted = filterCurrentIdentityEntities(entities ?? [], records);
  const visible = visibleReviewedClusters(clusters ?? [], members ?? [], admitted);
  const clusterIds = new Set(visible.map(cluster => cluster.id));
  return {
    clusters: visible,
    members: (members ?? []).filter(member => clusterIds.has(member.cluster_id) && isReviewedMembership(member, admitted)).map(member => ({
      ...member, entity: admitted.find(entity => entity.id === member.entity_id)!,
      join_reason: "An analyst supported this account's association with the dossier using the saved source and review. This group does not independently verify identity.",
    })),
  };
}

export function useIdentityClusters() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["identity_clusters", user?.id], enabled: !!user,
    queryFn: async () => (await loadReviewedGroups(user!.id)).clusters,
  });
}

export function useClusterMembers(clusterId: string | null) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["cluster_members", user?.id, clusterId], enabled: !!clusterId && !!user,
    queryFn: async () => (await loadReviewedGroups(user!.id)).members.filter(member => member.cluster_id === clusterId),
  });
}

export function useRunClustering() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [progress, setProgress] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not authenticated");
      return runIdentityClustering(user.id, setProgress);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["identity_clusters"] });
      qc.invalidateQueries({ queryKey: ["cluster_members"] });
      setProgress(null);
    },
    onError: () => setProgress(null),
  });

  return { ...mutation, progress };
}
