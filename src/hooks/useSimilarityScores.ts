import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { runBehavioralSimilarity, readResearchComparisons } from "@/lib/similarityEngine";
import { useState } from "react";

export function useSimilarityScores() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["similarity_scores", user?.id], enabled: !!user,
    // Historical heuristic scores remain stored but cannot become current findings.
    queryFn: async () => readResearchComparisons(user!.id),
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
