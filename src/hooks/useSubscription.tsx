import { useEffect, useState, createContext, useContext, ReactNode, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { edgeFunctionError } from "@/lib/edgeFunctionError";

export type SubscriptionPlan = "free" | "professional" | "team" | "enterprise";

interface SubscriptionState {
  plan: SubscriptionPlan;
  subscribed: boolean;
  subscriptionEnd: string | null;
  loading: boolean;
  error: string | null;
  refreshSubscription: () => Promise<void>;
}

const SubscriptionContext = createContext<SubscriptionState>({
  plan: "free",
  subscribed: false,
  subscriptionEnd: null,
  loading: true,
  error: null,
  refreshSubscription: async () => {},
});

export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [plan, setPlan] = useState<SubscriptionPlan>("free");
  const [subscribed, setSubscribed] = useState(false);
  const [subscriptionEnd, setSubscriptionEnd] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refreshSequence = useRef(0);

  const refreshSubscription = useCallback(async () => {
    const request = ++refreshSequence.current;
    setLoading(true);
    if (!user) {
      setPlan("free");
      setSubscribed(false);
      setSubscriptionEnd(null);
      setError(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const { data, error: providerError } = await supabase.functions.invoke("check-subscription", { signal: controller.signal });
      if (providerError) throw await edgeFunctionError(providerError);
      if (!data || typeof data !== "object" || !["free", "professional", "team", "enterprise"].includes(data.plan) || typeof data.subscribed !== "boolean" || (data.subscription_end !== undefined && data.subscription_end !== null && typeof data.subscription_end !== "string")) throw new Error("Subscription service returned an invalid account-access response");
      if (request !== refreshSequence.current) return;
      setPlan(data.plan as SubscriptionPlan);
      setSubscribed(data.subscribed);
      setSubscriptionEnd(data.subscription_end ?? null);
      setError(null);
    } catch (failure) {
      // Retain the last verified plan, but prevent execution until access can be checked.
      if (request === refreshSequence.current) setError(controller.signal.aborted ? "Subscription verification timed out" : failure instanceof Error ? failure.message : "Subscription access could not be verified");
    } finally {
      clearTimeout(timeout);
      if (request === refreshSequence.current) setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    refreshSubscription();

    // Auto-refresh every 60s
    const interval = setInterval(refreshSubscription, 60_000);
    return () => { clearInterval(interval); refreshSequence.current++; };
  }, [refreshSubscription]);

  return (
    <SubscriptionContext.Provider value={{ plan, subscribed, subscriptionEnd, loading, error, refreshSubscription }}>
      {children}
    </SubscriptionContext.Provider>
  );
}

export const useSubscription = () => useContext(SubscriptionContext);
