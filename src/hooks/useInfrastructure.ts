import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export function useInfrastructureLinks() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["infrastructure_links", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("infrastructure_links")
        .select("*, entity:identity_entities!infrastructure_links_entity_id_fkey(*)")
        .eq("user_id", user!.id)
        .order("confidence_score", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}
