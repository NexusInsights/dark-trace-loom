import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { runIdentityClustering } from "@/lib/clusteringEngine";
import { useState } from "react";

export function useIdentityClusters() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["identity_clusters", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("identity_clusters")
        .select("*")
        .eq("user_id", user!.id)
        .order("cluster_score", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useClusterMembers(clusterId: string | null) {
  return useQuery({
    queryKey: ["cluster_members", clusterId],
    enabled: !!clusterId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cluster_members")
        .select("*, entity:identity_entities(*)")
        .eq("cluster_id", clusterId!)
        .order("confidence_score", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
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
      setProgress(null);
    },
    onError: () => setProgress(null),
  });

  return { ...mutation, progress };
}
