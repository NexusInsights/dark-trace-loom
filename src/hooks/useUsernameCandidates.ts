import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { runUsernamePermutation } from "@/lib/usernamePermutationEngine";
import { usernamePermutationSchema } from "@/lib/validations";
import { checkRateLimit } from "@/lib/rateLimiter";
import { useState } from "react";

export function useUsernameCandidates(personaId: string | null) {
  return useQuery({
    queryKey: ["username_candidates", personaId],
    enabled: !!personaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("username_candidates")
        .select("*")
        .eq("persona_id", personaId!)
        .order("confidence_score", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useRunUsernamePermutation() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [progress, setProgress] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async (params: { personaId: string; firstName?: string; lastName?: string; knownUsername?: string }) => {
      if (!user) throw new Error("Not authenticated");
      const result = usernamePermutationSchema.safeParse(params);
      if (!result.success) throw new Error(result.error.issues[0]?.message ?? "Invalid input");
      const rl = checkRateLimit(`username_perm:${user.id}`);
      if (!rl.allowed) throw new Error(`Rate limited. Try again in ${Math.ceil(rl.retryAfterMs / 1000)}s`);
      return runUsernamePermutation(user.id, params.personaId, params.firstName, params.lastName, params.knownUsername, setProgress);
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["username_candidates", vars.personaId] });
      setProgress(null);
    },
    onError: () => setProgress(null),
  });

  return { ...mutation, progress };
}
