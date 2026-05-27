import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export function useBreachRecords(entityId?: string | null) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["breach_records", user?.id, entityId ?? "all"],
    enabled: !!user,
    queryFn: async () => {
      let query = supabase
        .from("breach_records")
        .select("*, entity:identity_entities!breach_records_entity_id_fkey(*)")
        .eq("user_id", user!.id)
        .order("severity", { ascending: true });

      if (entityId) {
        query = query.eq("entity_id", entityId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useBreachStats() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["breach_stats", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("breach_records")
        .select("severity, credential_leaked, password_reuse_detected")
        .eq("user_id", user!.id);
      if (error) throw error;

      const records = data ?? [];
      return {
        total: records.length,
        critical: records.filter((r) => r.severity === "critical").length,
        high: records.filter((r) => r.severity === "high").length,
        medium: records.filter((r) => r.severity === "medium").length,
        credentialsLeaked: records.filter((r) => r.credential_leaked).length,
        passwordReuse: records.filter((r) => r.password_reuse_detected).length,
      };
    },
  });
}
