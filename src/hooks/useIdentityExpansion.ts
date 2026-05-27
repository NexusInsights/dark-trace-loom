import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { buildPersonaTimeline } from "@/lib/personaTimelineEngine";

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

export function useRunExpansion() {
  const { user } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      entity_id: string;
      entity_type: string;
      entity_value: string;
    }) => {
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase.functions.invoke("identity-expansion", {
        body: {
          entity_id: params.entity_id,
          entity_type: params.entity_type,
          entity_value: params.entity_value,
          user_id: user.id,
        },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: async (data) => {
      qc.invalidateQueries({ queryKey: ["expansion_logs"] });
      qc.invalidateQueries({ queryKey: ["identity_entities"] });
      qc.invalidateQueries({ queryKey: ["identity_links"] });
      qc.invalidateQueries({ queryKey: ["identity_clusters"] });
      qc.invalidateQueries({ queryKey: ["personas"] });
      qc.invalidateQueries({ queryKey: ["persona_identifiers"] });
      qc.invalidateQueries({ queryKey: ["username_candidates"] });
      qc.invalidateQueries({ queryKey: ["email_candidates"] });

      const r = data?.results;
      const personaId = r?.persona?.persona_id;

      // Auto-build persona timeline if a persona was created or found
      if (personaId && user) {
        try {
          const { eventsCreated } = await buildPersonaTimeline(user.id, personaId);
          qc.invalidateQueries({ queryKey: ["persona_events", personaId] });
          if (eventsCreated > 0) {
            toast.success(`Timeline updated: ${eventsCreated} events`);
          }
        } catch {
          // Non-blocking — don't fail the expansion for timeline errors
        }
      }

      const summary = [
        r?.persona?.action === "created" ? "persona created" : null,
        r?.permutations?.generated ? `${r.permutations.generated} permutations` : null,
        r?.linking?.links_created ? `${r.linking.links_created} links` : null,
        r?.clustering?.action?.includes("added") ? "cluster updated" : null,
      ].filter(Boolean).join(", ");
      toast.success(`Expansion complete: ${summary || "done"}`);
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Expansion failed");
    },
  });
}
