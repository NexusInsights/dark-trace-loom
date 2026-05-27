import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { buildPersonaTimeline } from "@/lib/personaTimelineEngine";
import { useState } from "react";

export function usePersonaEvents(personaId: string | null) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["persona_events", personaId, user?.id],
    enabled: !!personaId && !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("persona_events")
        .select("*")
        .eq("persona_id", personaId!)
        .eq("user_id", user!.id)
        .order("event_timestamp", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useBuildPersonaTimeline() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [progress, setProgress] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async (personaId: string) => {
      if (!user) throw new Error("Not authenticated");
      return buildPersonaTimeline(user.id, personaId, setProgress);
    },
    onSuccess: (_, personaId) => {
      qc.invalidateQueries({ queryKey: ["persona_events", personaId] });
      setProgress(null);
    },
    onError: () => setProgress(null),
  });

  return { ...mutation, progress };
}
