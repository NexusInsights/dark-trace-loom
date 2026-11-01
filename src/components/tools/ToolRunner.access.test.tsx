import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Search } from "lucide-react";
import type { ToolDefinition } from "./types";

const harness = vi.hoisted(() => ({
  auth: { user: { id: "enterprise-user" }, loading: false } as { user: { id: string } | null; loading: boolean },
  subscription: { plan: "free", loading: true, error: null } as { plan: "free" | "enterprise"; loading: boolean; error?: string | null },
  usage: { dailyTotal: 12, loading: false, error: null } as { dailyTotal: number; loading: boolean; error?: string | null },
  recordExecution: vi.fn(), audit: vi.fn(), permission: vi.fn(), from: vi.fn(), process: vi.fn(), toastError: vi.fn(), refreshSubscription: vi.fn(), refreshUsage: vi.fn(),
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => harness.auth }));
vi.mock("@/hooks/useSubscription", () => ({ useSubscription: () => ({ ...harness.subscription, refreshSubscription: harness.refreshSubscription }) }));
vi.mock("@/hooks/useUsageTracking", () => ({ useUsageTracking: () => ({ ...harness.usage, recordExecution: harness.recordExecution, refresh: harness.refreshUsage }) }));
vi.mock("@/hooks/useAuditLog", () => ({ useAuditLog: () => ({ log: harness.audit }) }));
vi.mock("@/hooks/useInvestigationData", () => ({ useCases: () => ({ data: [] }) }));
vi.mock("@/lib/rateLimiter", () => ({ checkRateLimit: () => ({ allowed: true, retryAfterMs: 0 }) }));
vi.mock("./marketplaceRemoteTools", () => ({ getMarketplaceStatus: async () => ({ configured: true, missing_secrets: [], source: "test provider", coverage: "supplied input" }) }));
vi.mock("./UpgradePrompt", () => ({ UpgradePrompt: ({ reason }: { reason: string }) => <div role="alert">{reason}</div> }));
vi.mock("sonner", () => ({ toast: { error: harness.toastError, success: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: harness.from } }));
import { ToolRunner } from "./ToolRunner";

const tool: ToolDefinition = { id: "race-check-tool", name: "Race Check", description: "Supplied-input test operation", icon: Search, category: "Test", fields: [], integration: { provider: "test provider", scope: "supplied input" }, process: harness.process };

beforeEach(() => {
  vi.clearAllMocks();
  harness.auth = { user: { id: "enterprise-user" }, loading: false };
  harness.subscription = { plan: "free", loading: true };
  harness.usage = { dailyTotal: 12, loading: false };
  harness.permission.mockResolvedValue({ data: null, error: null });
  harness.from.mockImplementation(() => {
    const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: harness.permission };
    query.select.mockReturnValue(query); query.eq.mockReturnValue(query); return query;
  });
  harness.process.mockResolvedValue({ summary: "Supplied-input result", details: { actual_input: "test" } });
  harness.recordExecution.mockResolvedValue(13);
  harness.audit.mockResolvedValue(undefined);
  harness.refreshSubscription.mockResolvedValue(undefined); harness.refreshUsage.mockResolvedValue(undefined);
});

describe("tool account access loading", () => {
  it("waits for the Enterprise plan after fast provider readiness without applying the temporary Free limit", async () => {
    const { container, rerender } = render(<ToolRunner tool={tool} onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Provider configuration is present/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "EXECUTE" })).toBeDisabled();
    expect(screen.getByText("Checking account access…")).toBeInTheDocument();
    expect(screen.queryByText("12/5")).not.toBeInTheDocument();
    fireEvent.submit(container.querySelector("form")!);
    expect(harness.process).not.toHaveBeenCalled();
    expect(harness.from).not.toHaveBeenCalled();
    expect(screen.queryByText(/Daily tool limit reached/)).not.toBeInTheDocument();

    harness.subscription = { plan: "enterprise", loading: false };
    rerender(<ToolRunner tool={tool} onBack={() => {}} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "EXECUTE" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "EXECUTE" }));
    await waitFor(() => expect(screen.getByText("Supplied-input result")).toBeInTheDocument());
    expect(harness.process).toHaveBeenCalledTimes(1);
    expect(harness.recordExecution).toHaveBeenCalledWith("race-check-tool");
    expect(screen.queryByText(/Daily tool limit reached/)).not.toBeInTheDocument();
  });

  it.each(["auth", "usage"] as const)("does not run while %s is still loading", async pending => {
    harness.subscription = { plan: "enterprise", loading: false };
    if (pending === "auth") harness.auth.loading = true; else harness.usage.loading = true;
    const { container } = render(<ToolRunner tool={tool} onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Provider configuration is present/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "EXECUTE" })).toBeDisabled();
    fireEvent.submit(container.querySelector("form")!);
    expect(harness.process).not.toHaveBeenCalled();
    expect(harness.from).not.toHaveBeenCalled();
  });

  it("continues to enforce a loaded Free plan limit", async () => {
    harness.subscription = { plan: "free", loading: false };
    const { container } = render(<ToolRunner tool={tool} onBack={() => {}} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "EXECUTE" })).toBeEnabled());
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => expect(screen.getByText(/Daily tool limit reached \(5 runs\)/)).toBeInTheDocument());
    expect(harness.process).not.toHaveBeenCalled();
  });

  it.each(["subscription", "usage"] as const)("blocks execution after a failed %s verification and exposes a read-only retry", async failed => {
    harness.subscription = { plan: "enterprise", loading: false, error: null };
    if (failed === "subscription") harness.subscription.error = "Subscription service HTTP 503"; else harness.usage.error = "Daily usage database unavailable";
    const { container } = render(<ToolRunner tool={tool} onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Provider configuration is present/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "EXECUTE" })).toBeDisabled();
    expect(screen.getByText(/Account access verification failed/)).toHaveTextContent(failed === "subscription" ? "HTTP 503" : "database unavailable");
    fireEvent.submit(container.querySelector("form")!);
    expect(harness.process).not.toHaveBeenCalled();
    expect(harness.from).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Refresh account access" }));
    await waitFor(() => expect(harness.refreshSubscription).toHaveBeenCalledTimes(1));
    expect(harness.refreshUsage).toHaveBeenCalledTimes(1);
  });
});
