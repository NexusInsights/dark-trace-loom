import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

export function useExpansionLogs(entityId?: string | null) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["expansion_logs", user?.id, entityId],
    enabled: !!user,
    queryFn: async () => {
      let query = supabase
        .from("expansion_logs")
        .select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(100);
      if (entityId) query = query.eq("trigger_entity_id", entityId);
      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
  });
}

export const LEGACY_EXPANSION_MESSAGE = "Automatic identity expansion is unavailable. Use Persona Discovery with a known public profile or exact username, then review the sources. Generated handles and similar names do not establish an association.";

export function useRunExpansion() {
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (params: { entity_id: string; entity_type: string; entity_value: string }) => {
      if (!user) throw new Error("Not authenticated");
      if (!params.entity_id || !params.entity_type || !params.entity_value) throw new Error("Select an observed account first");
      // Do not invoke a possibly older deployed endpoint: it persisted fabricated
      // permutations and fixed-score identity links without any source request.
      return { status: "not_configured" as const, success: false, reason: LEGACY_EXPANSION_MESSAGE };
    },
    onSuccess: (result) => { toast.info(result.reason); },
    onError: (error) => { toast.error(error instanceof Error ? error.message : "Expansion unavailable"); },
  });
}
