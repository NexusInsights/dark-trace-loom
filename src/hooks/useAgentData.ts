import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { executeAgentRun, type AgentRunState } from "@/lib/agentEngine";
import type { Json } from "@/integrations/supabase/types";

// ─── Agents ───

export function useAgents() {
  return useQuery({
    queryKey: ["agents"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agents")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useCreateAgent() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: { name: string; description?: string; tool_sequence: string[] }) => {
      if (!user) throw new Error("Must be signed in");
      const { data, error } = await supabase
        .from("agents")
        .insert({
          name: input.name,
          description: input.description ?? null,
          owner_id: user.id,
          tool_sequence: input.tool_sequence,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agents"] });
      toast.success("Agent created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ─── Agent Runs ───

export function useAgentRuns(agentId?: string) {
  return useQuery({
    queryKey: ["agent-runs", agentId],
    queryFn: async () => {
      let query = supabase
        .from("agent_runs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (agentId) query = query.eq("agent_id", agentId);
      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useRunAgent() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [runState, setRunState] = useState<AgentRunState | null>(null);

  const startRun = useCallback(
    async (agentId: string, toolSequence: string[], subject: string, caseId: string | null) => {
      if (!user) {
        toast.error("Must be signed in");
        return null;
      }

      // Create run record
      const { data: run, error } = await supabase
        .from("agent_runs")
        .insert({
          agent_id: agentId,
          case_id: caseId || null,
          user_id: user.id,
          status: "pending",
          input_data: { subject } as unknown as Json,
        })
        .select()
        .single();

      if (error || !run) {
        toast.error("Failed to start agent run");
        return null;
      }

      try {
        const finalState = await executeAgentRun(
          run.id,
          toolSequence,
          subject,
          caseId,
          (state) => setRunState({ ...state })
        );
        qc.invalidateQueries({ queryKey: ["agent-runs"] });
        qc.invalidateQueries({ queryKey: ["artifacts"] });
        toast.success("Agent run completed");
        return finalState;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Agent run failed");
        return null;
      }
    },
    [user, qc]
  );

  return { startRun, runState, clearRunState: () => setRunState(null) };
}

