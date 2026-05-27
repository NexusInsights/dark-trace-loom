import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export function useSuggestions(caseId: string | null) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["investigation_suggestions", user?.id, caseId],
    enabled: !!user && !!caseId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("investigation_suggestions")
        .select("*")
        .eq("user_id", user!.id)
        .eq("case_id", caseId!)
        .eq("dismissed", false)
        .order("confidence_score", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}
