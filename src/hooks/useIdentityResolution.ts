import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export function useIdentityEntities() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["identity_entities", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("identity_entities")
        .select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useIdentityLinks() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["identity_links", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("identity_entity_links")
        .select("*, source:identity_entities!identity_entity_links_source_entity_id_fkey(*), target:identity_entities!identity_entity_links_target_entity_id_fkey(*)")
        .eq("user_id", user!.id)
        .order("confidence_score", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useEntityObservations(entityId: string | null) {
  return useQuery({
    queryKey: ["entity_observations", entityId],
    enabled: !!entityId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("entity_observations")
        .select("*, case:cases(id, title)")
        .eq("entity_id", entityId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useEntityScores() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["entity_scores", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("entity_scores")
        .select("*")
        .eq("user_id", user!.id)
        .order("score", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}
