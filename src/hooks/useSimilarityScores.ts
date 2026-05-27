import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { runBehavioralSimilarity } from "@/lib/similarityEngine";
import { useState } from "react";

export function useSimilarityScores() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["similarity_scores", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("similarity_scores")
        .select("*")
        .eq("user_id", user!.id)
        .order("similarity_score", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useRunSimilarity() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [progress, setProgress] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not authenticated");
      return runBehavioralSimilarity(user.id, setProgress);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["similarity_scores"] });
      setProgress(null);
    },
    onError: () => setProgress(null),
  });

  return { ...mutation, progress };
}
