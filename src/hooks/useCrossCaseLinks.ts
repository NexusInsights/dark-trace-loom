import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export function useCrossCaseLinks(caseId: string | null) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["cross_case_links", user?.id, caseId],
    enabled: !!user && !!caseId,
    queryFn: async () => {
      // Get links where this case is either source or target
      const [{ data: asSource }, { data: asTarget }] = await Promise.all([
        supabase
          .from("cross_case_links")
          .select("*, entity:identity_entities!cross_case_links_entity_id_fkey(entity_type, entity_value), linked:cases!cross_case_links_linked_case_id_fkey(id, title)")
          .eq("user_id", user!.id)
          .eq("case_id", caseId!)
          .eq("acknowledged", false),
        supabase
          .from("cross_case_links")
          .select("*, entity:identity_entities!cross_case_links_entity_id_fkey(entity_type, entity_value), linked:cases!cross_case_links_case_id_fkey(id, title)")
          .eq("user_id", user!.id)
          .eq("linked_case_id", caseId!)
          .eq("acknowledged", false),
      ]);

      return [...(asSource ?? []), ...(asTarget ?? [])];
    },
  });
}

export function useCrossCaseStats() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["cross_case_stats", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cross_case_links")
        .select("id, severity, acknowledged")
        .eq("user_id", user!.id)
        .eq("acknowledged", false);
      if (error) throw error;
      return {
        total: data?.length ?? 0,
        critical: data?.filter((d) => d.severity === "critical").length ?? 0,
        warning: data?.filter((d) => d.severity === "warning").length ?? 0,
      };
    },
  });
}
