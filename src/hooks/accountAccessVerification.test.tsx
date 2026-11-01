import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const harness = vi.hoisted(() => ({ invoke: vi.fn(), usageQuery: vi.fn(), auth: { user: { id: "enterprise-user" } } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => harness.auth }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: harness.invoke }, from: () => {
  const query = { select: () => query, eq: () => query, abortSignal: harness.usageQuery };
  return query;
} } }));
import { SubscriptionProvider, useSubscription } from "./useSubscription";
import { useUsageTracking } from "./useUsageTracking";

const wrapper = ({ children }: { children: ReactNode }) => <SubscriptionProvider>{children}</SubscriptionProvider>;

beforeEach(() => {
  vi.clearAllMocks();
  harness.invoke.mockResolvedValue({ data: { plan: "enterprise", subscribed: true, subscription_end: "2099-12-31T00:00:00Z" }, error: null });
  harness.usageQuery.mockResolvedValue({ data: [{ executions: 12 }], error: null });
});

describe("subscription evidence on failures", () => {
  it("preserves the last verified Enterprise plan and exposes a failed refresh", async () => {
    const { result } = renderHook(useSubscription, { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.plan).toBe("enterprise");
    expect(result.current.error).toBeNull();
    harness.invoke.mockResolvedValueOnce({ data: null, error: new Error("Subscription HTTP 503") });
    await act(() => result.current.refreshSubscription());
    expect(result.current.plan).toBe("enterprise");
    expect(result.current.subscribed).toBe(true);
    expect(result.current.subscriptionEnd).toBe("2099-12-31T00:00:00Z");
    expect(result.current.error).toContain("HTTP 503");
    expect(result.current.loading).toBe(false);
    await act(() => result.current.refreshSubscription());
    expect(result.current.error).toBeNull();
    expect(result.current.plan).toBe("enterprise");
  });

  it("does not treat malformed or failed initial verification as a verified Free entitlement", async () => {
    harness.invoke.mockResolvedValueOnce({ data: { plan: "unknown", subscribed: true }, error: null });
    const { result } = renderHook(useSubscription, { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toContain("invalid account-access response");
    expect(result.current.plan).toBe("free");
    expect(result.current.subscribed).toBe(false);
  });

  it("marks a pending refresh as loading while preserving verified values", async () => {
    const { result } = renderHook(useSubscription, { wrapper });
    await waitFor(() => expect(result.current.plan).toBe("enterprise"));
    let resolve!: (value: unknown) => void;
    harness.invoke.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    let pending!: Promise<void>;
    act(() => { pending = result.current.refreshSubscription(); });
    expect(result.current.loading).toBe(true);
    expect(result.current.plan).toBe("enterprise");
    await act(async () => { resolve({ data: { plan: "enterprise", subscribed: true, subscription_end: null }, error: null }); await pending; });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });
});

describe("daily usage evidence on failures", () => {
  it("preserves verified counts and exposes database errors instead of resetting to zero", async () => {
    const { result } = renderHook(useUsageTracking);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.dailyTotal).toBe(12);
    harness.usageQuery.mockResolvedValueOnce({ data: null, error: { message: "Usage database unavailable" } });
    await act(() => result.current.refresh());
    expect(result.current.dailyTotal).toBe(12);
    expect(result.current.error).toBe("Usage database unavailable");
    expect(result.current.loading).toBe(false);
    await act(() => result.current.refresh());
    expect(result.current.error).toBeNull();
    expect(result.current.dailyTotal).toBe(12);
  });

  it("blocks malformed usage responses while allowing a verified empty usage list", async () => {
    harness.usageQuery.mockResolvedValueOnce({ data: null, error: null });
    const { result } = renderHook(useUsageTracking);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toContain("invalid execution counts");
    harness.usageQuery.mockResolvedValueOnce({ data: [], error: null });
    await act(() => result.current.refresh());
    expect(result.current.error).toBeNull();
    expect(result.current.dailyTotal).toBe(0);
  });
});
