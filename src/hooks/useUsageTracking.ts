import { checkedDatabase } from "@/lib/checkedDatabase";
import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/** Returns start/end of the current UTC day */
function todayRange() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(start.getTime() + 86_400_000); // +24h
  return { periodStart: start.toISOString(), periodEnd: end.toISOString() };
}

export interface UsageRefreshOptions { background?: boolean }

export function useUsageTracking() {
  const { user } = useAuth();
  const [dailyTotal, setDailyTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refreshSequence = useRef(0);
  const activeAccount = useRef(user?.id ?? null);
  const requestedAccount = useRef(user?.id ?? null);
  const lastVerified = useRef<{ accountId: string; periodStart: string } | null>(null);

  const fetchDailyTotal = useCallback(async (options: UsageRefreshOptions = {}) => {
    if (activeAccount.current !== (user?.id ?? null)) return;
    const request = ++refreshSequence.current;
    const accountId = user?.id ?? null;
    const { periodStart } = todayRange();
    if (requestedAccount.current !== accountId) {
      lastVerified.current = null;
      setDailyTotal(0); setError(null);
    }
    requestedAccount.current = accountId;
    // A routine post-action refresh must not masquerade as revoked access. Initial,
    // other-account and new-day verification retain the blocking legacy behavior.
    const background = options.background === true && accountId !== null && lastVerified.current?.accountId === accountId && lastVerified.current.periodStart === periodStart;
    if (!background) setLoading(true);
    if (!user) { lastVerified.current = null; setDailyTotal(0); setError(null); setLoading(false); return; }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const { data } = await checkedDatabase(supabase
        .from("usage_metrics")
        .select("executions")
        .eq("user_id", user.id)
        .eq("period_start", periodStart)
        .abortSignal(controller.signal));
      if (!Array.isArray(data) || data.some(row => row.executions !== null && (typeof row.executions !== "number" || !Number.isInteger(row.executions) || row.executions < 0))) throw new Error("Daily usage service returned invalid execution counts");
      const total = data.reduce((sum, row) => sum + (row.executions ?? 0), 0);
      if (!Number.isSafeInteger(total)) throw new Error("Daily usage count exceeded the valid numeric range");
      if (request !== refreshSequence.current) return;
      lastVerified.current = { accountId: user.id, periodStart };
      setDailyTotal(total); setError(null);
    } catch (failure) {
      if (request === refreshSequence.current) setError(controller.signal.aborted ? "Daily usage verification timed out" : failure instanceof Error ? failure.message : failure && typeof failure === "object" && "message" in failure ? String(failure.message) : "Daily usage could not be verified");
    } finally {
      clearTimeout(timeout);
      if (request === refreshSequence.current) setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    const lifecycle = { sequence: refreshSequence };
    activeAccount.current = user?.id ?? null;
    fetchDailyTotal();
    return () => { lifecycle.sequence.current++; };
  }, [fetchDailyTotal, user?.id]);

  /** Record one execution for a tool. Returns the new daily total. */
  const recordExecution = useCallback(async (toolName: string): Promise<number> => {
    if (!user) return dailyTotal;
    const { periodStart, periodEnd } = todayRange();

    // Try to find existing row for this tool + today
    const { data: existing } = await checkedDatabase(supabase
      .from("usage_metrics")
      .select("id, executions")
      .eq("user_id", user.id)
      .eq("tool_name", toolName)
      .eq("period_start", periodStart)
      .maybeSingle());

    if (existing) {
      await checkedDatabase(supabase
        .from("usage_metrics")
        .update({ executions: (existing.executions ?? 0) + 1 })
        .eq("id", existing.id));
    } else {
      await checkedDatabase(supabase
        .from("usage_metrics")
        .insert({
          user_id: user.id,
          tool_name: toolName,
          executions: 1,
          period_start: periodStart,
          period_end: periodEnd,
        }));
    }

    const newTotal = dailyTotal + 1;
    setDailyTotal(newTotal);
    return newTotal;
  }, [user, dailyTotal]);

  const sameAccount = requestedAccount.current === (user?.id ?? null);
  return { dailyTotal: sameAccount ? dailyTotal : 0, loading: loading || !sameAccount, error: sameAccount ? error : null, recordExecution, refresh: fetchDailyTotal };
}
