import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import IntelligenceLab from "./IntelligenceLab";

const mocks = vi.hoisted(() => ({
  state: { plan: "professional", dailyTotal: 0, permissionsAllowed: true },
  refresh: vi.fn(async () => undefined), captureFingerprint: vi.fn(), getVisitorTracking: vi.fn(),
  enableVisitorTracking: vi.fn(), disableVisitorTracking: vi.fn(), runIntelligenceAction: vi.fn(),
  trainClassifier: vi.fn(), predict: vi.fn(), dispose: vi.fn(),
  permissionWait: null as Promise<void> | null,
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "test-user" } }) }));
vi.mock("@/hooks/useSubscription", () => ({ useSubscription: () => ({ plan: mocks.state.plan, loading: false }) }));
vi.mock("@/hooks/useUsageTracking", () => ({ useUsageTracking: () => ({ dailyTotal: mocks.state.dailyTotal, loading: false, refresh: mocks.refresh }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (table: string) => {
  const chain = {
    select: () => chain, eq: () => chain,
    in: async () => { if (mocks.permissionWait) await mocks.permissionWait; return { data: [{ allowed: mocks.state.permissionsAllowed }], error: null }; },
    maybeSingle: async () => ({ data: null, error: null }),
    insert: async () => ({ error: null }),
  };
  if (!["tool_permissions", "usage_metrics"].includes(table)) throw new Error(`Unexpected table in UI test: ${table}`);
  return chain;
} } }));
vi.mock("@/features/intelligence/browser-client.js", () => ({
  captureFingerprint: mocks.captureFingerprint, getVisitorTracking: mocks.getVisitorTracking,
  enableVisitorTracking: mocks.enableVisitorTracking, disableVisitorTracking: mocks.disableVisitorTracking,
}));
vi.mock("@/features/intelligence/api", () => ({ runIntelligenceAction: mocks.runIntelligenceAction }));
vi.mock("@/features/intelligence/classifier.js", () => ({
  exampleDataset: () => ({ synthetic: true, featureNames: ["clarity", "relevance"], samples: [{ features: [0, 1], label: 1 }] }),
  trainClassifier: mocks.trainClassifier,
}));

describe("Intelligence Lab integrated interactions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.state.plan = "professional"; mocks.state.dailyTotal = 0; mocks.state.permissionsAllowed = true;
    mocks.permissionWait = null;
    mocks.getVisitorTracking.mockReturnValue({ enabled: false, visitorId: null });
    mocks.enableVisitorTracking.mockReturnValue({ enabled: true, visitorId: "unique-browser-id" });
    mocks.disableVisitorTracking.mockReturnValue({ enabled: false, visitorId: null });
    mocks.captureFingerprint.mockResolvedValue({ visitorId: "fingerprint-fixture", scope: "current_browser" });
    mocks.runIntelligenceAction.mockResolvedValue({ source: "isolated worker fixture" });
    mocks.predict.mockResolvedValue({ probability: 0.8, label: 1 });
    mocks.trainClassifier.mockResolvedValue({ featureNames: ["clarity", "relevance"], metrics: { trainCount: 80, testCount: 20, accuracy: 0.8 }, predict: mocks.predict, dispose: mocks.dispose });
  });
  afterEach(cleanup);

  it("renders all seven features without initiating collection, training or provider calls", () => {
    render(<IntelligenceLab />);
    for (const name of ["Browser fingerprint", "Cookie tracking", "IPinfo geolocation", "Have I Been Pwned", "X public profile", "Tor onion reader", "TensorFlow outcome classifier"]) {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    }
    expect(mocks.captureFingerprint).not.toHaveBeenCalled();
    expect(mocks.enableVisitorTracking).not.toHaveBeenCalled();
    expect(mocks.runIntelligenceAction).not.toHaveBeenCalled();
    expect(mocks.trainClassifier).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Capture fingerprint" })).toBeDisabled();
  });

  it("captures the current browser only after consent and an explicit click", async () => {
    render(<IntelligenceLab />);
    fireEvent.click(screen.getByRole("checkbox", { name: "I agree to capture a fingerprint of this browser." }));
    fireEvent.click(screen.getByRole("button", { name: "Capture fingerprint" }));
    await screen.findByText(/fingerprint-fixture/);
    expect(mocks.captureFingerprint).toHaveBeenCalledTimes(1);
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("enables the app-specific cookie and allows withdrawal when the daily limit is reached", async () => {
    const { rerender } = render(<IntelligenceLab />);
    fireEvent.click(screen.getByRole("checkbox", { name: "I agree to remember this browser." }));
    fireEvent.click(screen.getByRole("button", { name: "Enable tracking" }));
    await screen.findByText("Enabled: unique-browser-id");
    expect(mocks.enableVisitorTracking).toHaveBeenCalledWith("insightnexus_visitor");
    mocks.state.plan = "free"; mocks.state.dailyTotal = 5;
    rerender(<IntelligenceLab />);
    fireEvent.click(screen.getByRole("button", { name: "Remove tracking cookie" }));
    expect(mocks.disableVisitorTracking).toHaveBeenCalledWith("insightnexus_visitor");
    expect(screen.getByText("Tracking is disabled.")).toBeInTheDocument();
  });

  it("keeps other tools usable when browser storage cannot be read", () => {
    mocks.getVisitorTracking.mockImplementationOnce(() => { throw new Error("Browser storage is blocked."); });
    render(<IntelligenceLab />);
    expect(screen.getByRole("alert")).toHaveTextContent("Browser storage is blocked.");
    expect(screen.getByRole("button", { name: "Run IPinfo geolocation" })).toBeEnabled();
  });

  it("submits an explicit provider input through the authenticated app API and renders escaped results", async () => {
    mocks.runIntelligenceAction.mockResolvedValue({ html: '<img src=x onerror="window.injected=true">' });
    const { container } = render(<IntelligenceLab />);
    fireEvent.change(screen.getByLabelText("Public IP address"), { target: { value: "8.8.8.8" } });
    fireEvent.click(screen.getByRole("button", { name: "Run IPinfo geolocation" }));
    await screen.findByText(/window.injected/);
    expect(mocks.runIntelligenceAction).toHaveBeenCalledWith("ipinfo", { ip: "8.8.8.8" });
    expect(container.querySelector("img")).toBeNull();
  });

  it("shows a missing-service error rather than presenting a successful lookup", async () => {
    mocks.runIntelligenceAction.mockRejectedValue(new Error("Configure the intelligence worker URL and token."));
    render(<IntelligenceLab />);
    fireEvent.change(screen.getByLabelText("X username"), { target: { value: "example" } });
    fireEvent.click(screen.getByRole("button", { name: "Run X public profile" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Configure the intelligence worker");
  });

  it("retains existing account plan and administrator controls", async () => {
    mocks.state.plan = "free"; mocks.state.dailyTotal = 5;
    render(<IntelligenceLab />);
    fireEvent.change(screen.getByLabelText("Public IP address"), { target: { value: "8.8.8.8" } });
    fireEvent.click(screen.getByRole("button", { name: "Run IPinfo geolocation" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Daily tool limit reached");
    expect(mocks.runIntelligenceAction).not.toHaveBeenCalled();
  });

  it("connects dataset loading, training metrics, prediction and model cleanup", async () => {
    const { unmount } = render(<IntelligenceLab />);
    fireEvent.click(screen.getByRole("button", { name: "Load synthetic example" }));
    expect((screen.getByLabelText("Labeled dataset JSON") as HTMLTextAreaElement).value).toContain('"synthetic": true');
    fireEvent.click(screen.getByRole("button", { name: "Train and evaluate" }));
    await screen.findByText("Training and held-out evaluation complete.");
    expect(mocks.trainClassifier).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText(/Prediction features/), { target: { value: "[0.2,0.8]" } });
    fireEvent.click(screen.getByRole("button", { name: "Predict outcome" }));
    await screen.findByText(/"probability": 0.8/);
    expect(mocks.predict).toHaveBeenCalledWith([0.2, 0.8]);
    unmount();
    expect(mocks.dispose).toHaveBeenCalledTimes(1);
  });

  it("cancels before a delayed account check finishes without starting a model", async () => {
    let releasePermission: () => void;
    mocks.permissionWait = new Promise<void>((resolve) => { releasePermission = resolve; });
    render(<IntelligenceLab />);
    fireEvent.click(screen.getByRole("button", { name: "Load synthetic example" }));
    fireEvent.click(screen.getByRole("button", { name: "Train and evaluate" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel training" }));
    await act(async () => { releasePermission(); });
    expect(await screen.findByRole("alert")).toHaveTextContent("Training was cancelled.");
    expect(mocks.trainClassifier).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Predict outcome" })).toBeDisabled();
  });

  it("disposes a model that resolves after navigation instead of retaining it", async () => {
    let resolveTraining: (value: unknown) => void;
    mocks.trainClassifier.mockImplementationOnce(() => new Promise((resolve) => { resolveTraining = resolve; }));
    const { unmount } = render(<IntelligenceLab />);
    fireEvent.click(screen.getByRole("button", { name: "Load synthetic example" }));
    fireEvent.click(screen.getByRole("button", { name: "Train and evaluate" }));
    await waitFor(() => expect(mocks.trainClassifier).toHaveBeenCalledTimes(1));
    const options = mocks.trainClassifier.mock.calls[0][1];
    unmount();
    expect(options.signal.aborted).toBe(true);
    await act(async () => { resolveTraining({ featureNames: ["x"], metrics: {}, predict: mocks.predict, dispose: mocks.dispose }); });
    expect(mocks.dispose).toHaveBeenCalledTimes(1);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("ignores late epoch updates and disposes a model resolving after cancellation", async () => {
    let resolveTraining: (value: unknown) => void;
    mocks.trainClassifier.mockImplementationOnce(() => new Promise((resolve) => { resolveTraining = resolve; }));
    render(<IntelligenceLab />);
    fireEvent.click(screen.getByRole("button", { name: "Load synthetic example" }));
    fireEvent.click(screen.getByRole("button", { name: "Train and evaluate" }));
    await waitFor(() => expect(mocks.trainClassifier).toHaveBeenCalledTimes(1));
    const options = mocks.trainClassifier.mock.calls[0][1];
    fireEvent.click(screen.getByRole("button", { name: "Cancel training" }));
    act(() => options.onEpoch(10));
    expect(screen.queryByText("Epoch 10 of 10")).not.toBeInTheDocument();
    await act(async () => { resolveTraining({ featureNames: ["x"], metrics: {}, predict: mocks.predict, dispose: mocks.dispose }); });
    expect(await screen.findByRole("alert")).toHaveTextContent("Training was cancelled.");
    expect(mocks.dispose).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Predict outcome" })).toBeDisabled();
  });
});
