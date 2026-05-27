import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export function useSocialGraphEdges() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["social_graph_edges", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("social_graph_edges")
        .select("*, source:identity_entities!social_graph_edges_source_entity_id_fkey(*), target:identity_entities!social_graph_edges_target_entity_id_fkey(*)")
        .eq("user_id", user!.id)
        .order("confidence_score", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}
