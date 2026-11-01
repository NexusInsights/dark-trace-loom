import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const harness = vi.hoisted(() => ({
  auth: { user: { id: "fixture-user" }, loading: false },
  subscription: { plan: "enterprise", loading: false, error: null as string | null },
  usage: { dailyTotal: 12, loading: false, error: null as string | null },
  from: vi.fn(), refresh: vi.fn(), refreshSubscription: vi.fn(), run: vi.fn(), capture: vi.fn(), remove: vi.fn(),
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => harness.auth }));
vi.mock("@/hooks/useSubscription", () => ({ useSubscription: () => ({ ...harness.subscription, refreshSubscription: harness.refreshSubscription }) }));
vi.mock("@/hooks/useUsageTracking", () => ({ useUsageTracking: () => ({ ...harness.usage, refresh: harness.refresh }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: harness.from } }));
vi.mock("@/features/intelligence/api", () => ({ runIntelligenceAction: harness.run }));
vi.mock("@/features/intelligence/browser-client.js", () => ({
  getVisitorTracking: () => ({ enabled: false, visitorId: null }),
  captureFingerprint: harness.capture,
  enableVisitorTracking: vi.fn(),
  disableVisitorTracking: harness.remove,
}));
vi.mock("@/features/intelligence/classifier.js", () => ({ exampleDataset: vi.fn(), trainClassifier: vi.fn() }));
import IntelligenceLab from "./IntelligenceLab";

beforeEach(() => {
  cleanup(); vi.clearAllMocks();
  harness.auth = { user: { id: "fixture-user" }, loading: false };
  harness.subscription = { plan: "enterprise", loading: false, error: null };
  harness.usage = { dailyTotal: 12, loading: false, error: null };
  harness.refresh.mockResolvedValue(undefined); harness.refreshSubscription.mockResolvedValue(undefined);
  harness.run.mockResolvedValue({ source: "explicit provider fixture", ip: "8.8.8.8" });
  harness.remove.mockReturnValue({ enabled: false, visitorId: null });
  harness.from.mockImplementation(() => {
    const query = { select: vi.fn(), eq: vi.fn(), in: vi.fn().mockResolvedValue({ data: [], error: null }) };
    query.select.mockReturnValue(query); query.eq.mockReturnValue(query); return query;
  });
});

describe("Intelligence Lab preserves production account verification", () => {
  it.each(["subscription", "usage"] as const)("blocks actions after a failed %s check, allows read-only retry and cookie withdrawal", async (failed) => {
    harness[failed].error = `${failed} fixture unavailable`;
    const { container } = render(<IntelligenceLab />);
    expect(screen.getByRole("button", { name: "Run IPinfo geolocation" })).toBeDisabled();
    expect(screen.getByText(/Account access verification failed/)).toHaveTextContent(`${failed} fixture unavailable`);
    fireEvent.change(screen.getByLabelText("Public IP address"), { target: { value: "8.8.8.8" } });
    fireEvent.submit(container.querySelector("form")!);
    expect(harness.from).not.toHaveBeenCalled(); expect(harness.run).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Refresh account access" }));
    await waitFor(() => expect(harness.refresh).toHaveBeenCalledOnce());
    expect(harness.refreshSubscription).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Remove tracking cookie" }));
    expect(harness.remove).toHaveBeenCalledWith("insightnexus_visitor");
  });

  it("waits for authentication and runs a remote tool only after verified access", async () => {
    harness.auth.loading = true;
    const { rerender, container } = render(<IntelligenceLab />);
    expect(screen.getByRole("button", { name: "Run IPinfo geolocation" })).toBeDisabled();
    fireEvent.submit(container.querySelector("form")!);
    expect(harness.run).not.toHaveBeenCalled();
    harness.auth.loading = false; rerender(<IntelligenceLab />);
    fireEvent.change(screen.getByLabelText("Public IP address"), { target: { value: "8.8.8.8" } });
    fireEvent.click(screen.getByRole("button", { name: "Run IPinfo geolocation" }));
    await waitFor(() => expect(harness.run).toHaveBeenCalledWith("ipinfo", { ip: "8.8.8.8" }));
    await waitFor(() => expect(screen.getByLabelText("Tool result")).toHaveTextContent("explicit provider fixture"));
    expect(harness.refresh).toHaveBeenCalledOnce(); expect(harness.capture).not.toHaveBeenCalled();
  });
});
