import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useEntityTimeline(entityId: string | null) {
  return useQuery({
    queryKey: ["entity_timeline", entityId],
    enabled: !!entityId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("entity_timeline")
        .select("*")
        .eq("entity_id", entityId!)
        .order("event_timestamp", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}
