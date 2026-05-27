import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { runEmailPermutation } from "@/lib/emailPermutationEngine";
import { emailPermutationSchema } from "@/lib/validations";
import { checkRateLimit } from "@/lib/rateLimiter";
import { useState } from "react";

export function useEmailCandidates(personaId: string | null) {
  return useQuery({
    queryKey: ["email_candidates", personaId],
    enabled: !!personaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_candidates")
        .select("*")
        .eq("persona_id", personaId!)
        .order("confidence_score", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useRunEmailPermutation() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [progress, setProgress] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async (params: { personaId: string; firstName?: string; lastName?: string; knownDomains?: string[]; companyDomains?: string[] }) => {
      if (!user) throw new Error("Not authenticated");
      const result = emailPermutationSchema.safeParse(params);
      if (!result.success) throw new Error(result.error.issues[0]?.message ?? "Invalid input");
      const rl = checkRateLimit(`email_perm:${user.id}`);
      if (!rl.allowed) throw new Error(`Rate limited. Try again in ${Math.ceil(rl.retryAfterMs / 1000)}s`);
      return runEmailPermutation(user.id, params.personaId, params.firstName, params.lastName, params.knownDomains, params.companyDomains, setProgress);
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["email_candidates", vars.personaId] });
      setProgress(null);
    },
    onError: () => setProgress(null),
  });

  return { ...mutation, progress };
}
