import { checkedDatabase } from "@/lib/checkedDatabase";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { filterCurrentIdentityEntities, isCurrentConnectivityScore } from "@/lib/identityEvidence";
import { loadIdentitySourceRecords } from "@/lib/loadIdentityEvidence";

export function useIdentityEntities() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["identity_entities", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await checkedDatabase(supabase
        .from("identity_entities")
        .select("*")
        .eq("user_id", user!.id)
        .or("metadata->>resolution_excluded.is.null,metadata->>resolution_excluded.neq.true")
        .order("created_at", { ascending: false }));
      if (error) throw error;
      return filterCurrentIdentityEntities(data ?? [], await loadIdentitySourceRecords(user!.id));
    },
  });
}

export function useIdentityLinks() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["identity_links", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await checkedDatabase(supabase
        .from("identity_entity_links")
        .select("*, source:identity_entities!identity_entity_links_source_entity_id_fkey(*), target:identity_entities!identity_entity_links_target_entity_id_fkey(*)")
        .eq("user_id", user!.id)
        .order("confidence_score", { ascending: false }));
      if (error) throw error;
      const records = await loadIdentitySourceRecords(user!.id);
      return (data ?? []).filter(link => link.relationship_type === "analyst_supported_association" && link.source && link.target && filterCurrentIdentityEntities([link.source, link.target], records).length === 2);
    },
  });
}

export function useEntityObservations(entityId: string | null) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["entity_observations", entityId, user?.id],
    enabled: !!entityId && !!user,
    queryFn: async () => {
      const { data: entities } = await checkedDatabase(supabase.from("identity_entities").select("id,entity_type,entity_value,metadata").eq("user_id", user!.id));
      const admitted = filterCurrentIdentityEntities(entities ?? [], await loadIdentitySourceRecords(user!.id));
      if (!admitted.some(entity => entity.id === entityId)) return [];
      const { data, error } = await checkedDatabase(supabase
        .from("entity_observations")
        .select("*, case:cases(id, title)")
        .eq("entity_id", entityId!)
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false }));
      if (error) throw error;
      return (data ?? []).filter(observation => observation.source_tool?.startsWith("profile_association:"));
    },
  });
}

export function useEntityScores() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["entity_scores", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await checkedDatabase(supabase
        .from("entity_scores")
        .select("*")
        .eq("user_id", user!.id)
        .order("score", { ascending: false }));
      if (error) throw error;
      const { data: entities } = await checkedDatabase(supabase.from("identity_entities").select("id,entity_type,entity_value,metadata").eq("user_id", user!.id));
      const admitted = filterCurrentIdentityEntities(entities ?? [], await loadIdentitySourceRecords(user!.id));
      return (data ?? []).filter(score => admitted.some(entity => isCurrentConnectivityScore(score, entity)));
    },
  });
}
