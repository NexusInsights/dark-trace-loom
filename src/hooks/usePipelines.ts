import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

export function usePipelines() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["pipelines", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pipelines")
        .select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function usePipelineRuns(pipelineId?: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["pipeline_runs", pipelineId ?? "all", user?.id],
    enabled: !!user,
    queryFn: async () => {
      let query = supabase
        .from("pipeline_runs")
        .select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(50);

      if (pipelineId) {
        query = query.eq("pipeline_id", pipelineId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useCreatePipeline() {
  const { user } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (pipeline: {
      name: string;
      description?: string;
      schedule: string;
      tool_sequence: string[];
      target_case_id?: string | null;
      input_params?: Record<string, unknown>;
    }) => {
      const { data, error } = await supabase
        .from("pipelines")
        .insert([{ ...pipeline, user_id: user!.id }] as any)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pipelines"] });
      toast.success("Pipeline created");
    },
    onError: (err) => toast.error(err.message),
  });
}

export function useDeletePipeline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("pipelines").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pipelines"] });
      toast.success("Pipeline deleted");
    },
    onError: (err) => toast.error(err.message),
  });
}

export function useTogglePipeline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const { error } = await supabase
        .from("pipelines")
        .update({ enabled })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pipelines"] });
    },
    onError: (err) => toast.error(err.message),
  });
}
