import { checkedDatabase } from "@/lib/checkedDatabase";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { visibleSocialGraphEdges } from "@/lib/socialGraphEvidence";
import { loadIdentitySourceRecords } from "@/lib/loadIdentityEvidence";

export function useSocialGraphEdges() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["social_graph_edges", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await checkedDatabase(supabase
        .from("social_graph_edges")
        .select("*, source:identity_entities!social_graph_edges_source_entity_id_fkey(*), target:identity_entities!social_graph_edges_target_entity_id_fkey(*)")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false }));
      if (error) throw error;
      return visibleSocialGraphEdges(data ?? [], await loadIdentitySourceRecords(user!.id));
    },
  });
}
