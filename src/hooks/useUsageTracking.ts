import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/** Returns start/end of the current UTC day */
function todayRange() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(start.getTime() + 86_400_000); // +24h
  return { periodStart: start.toISOString(), periodEnd: end.toISOString() };
}

export function useUsageTracking() {
  const { user } = useAuth();
  const [dailyTotal, setDailyTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchDailyTotal = useCallback(async () => {
    if (!user) { setDailyTotal(0); setLoading(false); return; }
    const { periodStart, periodEnd } = todayRange();

    const { data, error } = await supabase
      .from("usage_metrics")
      .select("executions")
      .eq("user_id", user.id)
      .eq("period_start", periodStart);

    if (error) {
      console.error("Failed to fetch usage:", error.message);
      setLoading(false);
      return;
    }

    const total = (data ?? []).reduce((sum, row) => sum + (row.executions ?? 0), 0);
    setDailyTotal(total);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchDailyTotal();
  }, [fetchDailyTotal]);

  /** Record one execution for a tool. Returns the new daily total. */
  const recordExecution = useCallback(async (toolName: string): Promise<number> => {
    if (!user) return dailyTotal;
    const { periodStart, periodEnd } = todayRange();

    // Try to find existing row for this tool + today
    const { data: existing } = await supabase
      .from("usage_metrics")
      .select("id, executions")
      .eq("user_id", user.id)
      .eq("tool_name", toolName)
      .eq("period_start", periodStart)
      .maybeSingle();

    if (existing) {
      await supabase
        .from("usage_metrics")
        .update({ executions: (existing.executions ?? 0) + 1 })
        .eq("id", existing.id);
    } else {
      await supabase
        .from("usage_metrics")
        .insert({
          user_id: user.id,
          tool_name: toolName,
          executions: 1,
          period_start: periodStart,
          period_end: periodEnd,
        });
    }

    const newTotal = dailyTotal + 1;
    setDailyTotal(newTotal);
    return newTotal;
  }, [user, dailyTotal]);

  return { dailyTotal, loading, recordExecution, refresh: fetchDailyTotal };
}
