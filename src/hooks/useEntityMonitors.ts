import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

export type MonitorType =
  | "domain_registration"
  | "social_account"
  | "breach_appearance"
  | "infrastructure_change"
  | "username_activity";

export type MonitorFrequency = "realtime" | "hourly" | "daily" | "weekly";

export interface EntityMonitor {
  id: string;
  entity_id: string;
  user_id: string;
  monitor_type: string;
  frequency: string;
  enabled: boolean;
  last_checked: string | null;
  last_triggered: string | null;
  created_at: string;
  updated_at: string;
  entity?: {
    entity_type: string;
    entity_value: string;
  };
}

export function useEntityMonitors(entityId?: string) {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const monitors = useQuery({
    queryKey: ["entity-monitors", user?.id, entityId],
    enabled: !!user,
    queryFn: async () => {
      let query = supabase
        .from("entity_monitors")
        .select("*, entity:identity_entities!entity_monitors_entity_id_fkey(entity_type, entity_value)")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false });

      if (entityId) {
        query = query.eq("entity_id", entityId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as EntityMonitor[];
    },
  });

  const createMonitor = useMutation({
    mutationFn: async (input: {
      entity_id: string;
      monitor_type: MonitorType;
      frequency: MonitorFrequency;
    }) => {
      const { error } = await supabase.from("entity_monitors").insert({
        entity_id: input.entity_id,
        user_id: user!.id,
        monitor_type: input.monitor_type,
        frequency: input.frequency,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["entity-monitors"] });
      toast({ title: "Monitor created", description: "You'll be notified when changes are detected." });
    },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const toggleMonitor = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const { error } = await supabase
        .from("entity_monitors")
        .update({ enabled })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["entity-monitors"] }),
  });

  const deleteMonitor = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("entity_monitors")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["entity-monitors"] });
      toast({ title: "Monitor removed" });
    },
  });

  return { monitors, createMonitor, toggleMonitor, deleteMonitor };
}

export function useMonitorStats() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["entity-monitor-stats", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("entity_monitors")
        .select("id, enabled, monitor_type, last_triggered")
        .eq("user_id", user!.id);
      if (error) throw error;
      const all = data ?? [];
      return {
        total: all.length,
        active: all.filter((m) => m.enabled).length,
        triggered: all.filter((m) => m.last_triggered).length,
        byType: all.reduce((acc, m) => {
          acc[m.monitor_type] = (acc[m.monitor_type] ?? 0) + 1;
          return acc;
        }, {} as Record<string, number>),
      };
    },
  });
}
