import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { runPersonaDiscovery, PersonaInput } from "@/lib/personaDiscoveryEngine";
import { personaDiscoverySchema } from "@/lib/validations";
import { checkRateLimit } from "@/lib/rateLimiter";
import { useState } from "react";

export function usePersonas() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["personas", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("personas")
        .select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function usePersonaIdentifiers(personaId: string | null) {
  return useQuery({
    queryKey: ["persona_identifiers", personaId],
    enabled: !!personaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("persona_identifiers")
        .select("*")
        .eq("persona_id", personaId!)
        .order("confidence_score", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function usePersonaDiscovery() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [progress, setProgress] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async (input: PersonaInput) => {
      if (!user) throw new Error("Not authenticated");

      // Validate input
      const result = personaDiscoverySchema.safeParse(input);
      if (!result.success) {
        throw new Error(result.error.issues[0]?.message ?? "Invalid input");
      }

      // Rate limit
      const rl = checkRateLimit(`persona_discovery:${user.id}`);
      if (!rl.allowed) {
        throw new Error(`Rate limited. Try again in ${Math.ceil(rl.retryAfterMs / 1000)}s`);
      }

      return runPersonaDiscovery(user.id, result.data, setProgress);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["personas"] });
      setProgress(null);
    },
    onError: () => setProgress(null),
  });

  return { ...mutation, progress };
}

export function useDeletePersona() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (personaId: string) => {
      const { error } = await supabase.from("personas").delete().eq("id", personaId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["personas"] }),
  });
}
