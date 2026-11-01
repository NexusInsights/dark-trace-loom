import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createHash, webcrypto } from "node:crypto";
const harness = vi.hoisted(() => ({ request: vi.fn(), auth: { user: { id: "fixture-user" } as { id: string } | null, loading: false } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => harness.auth }));
vi.mock("@/lib/monitoringClient", () => ({ monitoringRequest: harness.request }));
import { MonitorCoveragePanel } from "./MonitorCoveragePanel";

const job = {
  id: "11111111-1111-4111-8111-111111111111", label: "Approved feed fixture", kind: "rss", params: { url: "https://approved.example/feed" }, enabled: true, interval_seconds: 300,
  coverage: { state: "blocked", last_attempt: 2000, last_success: 1000, last_verified_state: "found", stale: true, reason: "Source fixture returned HTTP 403", source_status: 403 },
  budget: { day: "2026-11-01", approved_daily_limit: 0, used: 0, remaining: 0, requires_licensed_bridge: false },
};
const snapshot = { source: "https://approved.example/feed", coverage: "Isolated test feed", data: { items: ["Alpha"] } };
const digest = createHash("sha256").update('{"items":["Alpha"]}').digest("hex");
beforeEach(() => {
  cleanup(); vi.clearAllMocks(); vi.stubGlobal("crypto", webcrypto);
  harness.auth = { user: { id: "fixture-user" }, loading: false };
  harness.request.mockImplementation(async (path: string, method = "GET") => {
    if (path === "/v1/status") return { configured: true, authorized_page_hosts: ["approved.example"], scheduler: {} };
    if (path === "/v1/jobs" && method === "GET") return { jobs: [job] };
    if (path.includes("/history")) return { job, history_limit: 20, history: [{ id: "blocked-check", state: "failed", observed_at: 2000, error: "Source fixture returned HTTP 403", failure_receipt: { coverage_state: "blocked" } }], latest_verified: { observed_at: 1000, content_hash: digest, snapshot } };
    return { id: "created-fixture" };
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("monitor snapshots and coverage interface", () => {
  it("shows failed coverage separately from retained evidence and verifies its real hash", async () => {
    render(<MonitorCoveragePanel />);
    await screen.findByText("Blocked");
    expect(screen.getByText(/Last successful source check:/)).toHaveTextContent("Last attempt:");
    expect(screen.getByText(/Earlier verified evidence is stale/)).toBeInTheDocument();
    expect(harness.request.mock.calls.every(([, method]) => !method || method === "GET")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "View snapshots: Approved feed fixture" }));
    await screen.findByText("Later stored evidence");
    await screen.findByText("SHA-256 verified against stored receipt");
    expect(screen.getByText(/All returned check receipts/)).toHaveTextContent("1");
    expect(harness.request).toHaveBeenCalledWith(`/v1/jobs/${job.id}/history?limit=20`);
  });
  it("requires opt-in and an approved host, then creates only a zero-paid-allowance page job", async () => {
    render(<MonitorCoveragePanel />);
    await screen.findByText("Blocked");
    expect(screen.getByRole("button", { name: "Create authorized monitor" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Monitor label"), { target: { value: "Public source fixture" } });
    fireEvent.change(screen.getByLabelText("Public HTTPS source URL"), { target: { value: "https://unapproved.example/page" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Create authorized monitor" }));
    await screen.findByRole("alert");
    expect(harness.request.mock.calls.some(([path, method]) => path === "/v1/jobs" && method === "POST")).toBe(false);
    fireEvent.change(screen.getByLabelText("Public HTTPS source URL"), { target: { value: "https://approved.example/page" } });
    fireEvent.click(screen.getByRole("button", { name: "Create authorized monitor" }));
    await waitFor(() => expect(harness.request).toHaveBeenCalledWith("/v1/jobs", "POST", { kind: "page", label: "Public source fixture", params: { url: "https://approved.example/page" }, interval_seconds: 3600, polling_authorized: true, paid_daily_budget: 0 }));
  });
  it("clears another session's rows on logout and reports refresh failure without claiming empty coverage", async () => {
    const { rerender } = render(<MonitorCoveragePanel />);
    await screen.findByText("Blocked");
    harness.request.mockRejectedValue(new Error("Monitoring temporarily unavailable"));
    fireEvent.click(screen.getByRole("button", { name: "Refresh monitoring" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Monitoring temporarily unavailable");
    expect(screen.getByText("Approved feed fixture")).toBeInTheDocument();
    harness.auth.user = null; rerender(<MonitorCoveragePanel />);
    await screen.findByText("Sign in to inspect source history.");
    expect(screen.queryByText("Approved feed fixture")).not.toBeInTheDocument();
  });
});
