import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import fs from "node:fs";
import crypto from "node:crypto";
const state = vi.hoisted(() => ({
  status: "success", error: vi.fn(), success: vi.fn(), invoke: vi.fn(), usage: vi.fn(), audit: vi.fn(), denied: false, saveError: false,
  saved: [] as Record<string, unknown>[],
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "fixture-user" } }) }));
vi.mock("@/hooks/useSubscription", () => ({ useSubscription: () => ({ plan: "professional" }) }));
vi.mock("@/hooks/useUsageTracking", () => ({ useUsageTracking: () => ({ dailyTotal: 0, recordExecution: state.usage }) }));
vi.mock("@/hooks/useAuditLog", () => ({ useAuditLog: () => ({ log: state.audit }) }));
vi.mock("@/hooks/useInvestigationData", () => ({ useCases: () => ({ data: [{ id: "fixture-case", title: "SYNTHETIC CASE" }] }) }));
vi.mock("@/lib/rateLimiter", () => ({ checkRateLimit: () => ({ allowed: true }) }));
vi.mock("@/components/intel", () => ({ GlassPanel: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("sonner", () => ({ toast: { error: state.error, success: state.success } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: state.invoke }, auth: { getUser: async () => ({ data: { user: { id: "fixture-user" } }, error: null }) },
  from: (table: string) => {
    const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: table === "cases" ? { id: "fixture-case", owner_id: "fixture-user" } : { allowed: !state.denied }, error: null }),
      insert: async (payload: Record<string, unknown>) => { state.saved.push({ table, ...payload }); return { error: state.saveError ? { message: "SYNTHETIC RLS denied save" } : null }; },
    }; return query;
  },
} }));
import { ToolRunner } from "./ToolRunner";
import { allTools } from "./toolDefinitions";
import { IMAGE_HASH_ALGORITHM } from "../../../supabase/functions/_shared/imageHash";
const tool = allTools.find(candidate => candidate.id === "reverse-image-hash")!;
const observations: Record<string, unknown>[] = [];
beforeEach(() => {
  cleanup(); state.status = "success"; state.denied = false; state.saveError = false; state.saved = []; state.error.mockReset(); state.success.mockReset();
  state.usage.mockResolvedValue(undefined); state.audit.mockResolvedValue(undefined); state.invoke.mockReset();
  state.invoke.mockImplementation(async () => ({ data: ["error", "not_configured", "unknown_tool"].includes(state.status)
    ? { status: state.status, reason: "SYNTHETIC " + state.status }
    : { status: state.status, result: { url: "https://example.invalid/synthetic.png", phash: "0000000000000000", dhash: "ffffffffffffffff", width: 9, height: 8, format: "png", bytes: 95, algorithm: IMAGE_HASH_ALGORITHM, sha256: "0".repeat(64), provenance: { source: "SYNTHETIC UI fixture; no decoder/network", source_url: "https://example.invalid/synthetic.png", phash_bits: 63, dhash_bits: 64 } } }, error: null }));
});
afterAll(() => {
  const paths = ["src/components/tools/ToolRunner.tsx", "src/components/tools/extraTools.ts", "src/components/tools/executeTool.ts", "src/lib/pipelineEngine.ts"];
  fs.writeFileSync("evidence/local-ui-persistence-acceptance.json", JSON.stringify({ scope: "Actual React ToolRunner, registry and executeTool with synthetic hooks, gateway and persistence. Rendered in jsdom; not signed-in real browser, real SQL/RLS, provider or production acceptance.",
    sourceFiles: paths.map(path => ({ path, sha256: crypto.createHash("sha256").update(fs.readFileSync(path)).digest("hex") })), observations }, null, 2));
});
const run = async () => {
  render(<ToolRunner tool={tool} onBack={() => undefined} />);
  fireEvent.change(screen.getByPlaceholderText("https://example.com/img.jpg"), { target: { value: "https://example.invalid/synthetic.png" } });
  fireEvent.click(screen.getByText("EXECUTE")); await screen.findByText(new RegExp("RESULTS.*" + state.status.toUpperCase()));
};
it.each(["success", "partial", "demo"])("renders and saves %s with truthful status and provenance", async status => {
  state.status = status; await run();
  if (status === "demo") expect(screen.getByText(/DEMO.*pHash/)).toBeInTheDocument();
  if (["success", "partial", "demo"].includes(status)) expect(screen.getByText(/SYNTHETIC UI fixture/)).toBeInTheDocument();
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "fixture-case" } }); fireEvent.click(screen.getByText("SAVE"));
  await screen.findByText("SAVED"); expect(state.saved).toHaveLength(1);
  expect(state.saved[0]).toMatchObject({ table: "tool_results", user_id: "fixture-user", case_id: "fixture-case", status, result_data: { status } });
  expect(state.saved.some(value => value.table === "artifacts")).toBe(false);
  observations.push({ status, renderedStatus: status.toUpperCase(), savedStatus: state.saved[0].status, saveTable: "tool_results", createsArtifacts: false, accepted: true });
});
it("keeps a denied persistence write unsaved without success feedback", async () => {
  state.saveError = true; await run(); fireEvent.click(screen.getByText("SAVE"));
  await waitFor(() => expect(state.error).toHaveBeenCalledWith("SYNTHETIC RLS denied save"));
  expect(screen.queryByText("SAVED")).not.toBeInTheDocument(); expect(state.success).not.toHaveBeenCalled();
});
it("blocks execution when the fixture admin permission explicitly denies it", async () => {
  state.denied = true; render(<ToolRunner tool={tool} onBack={() => undefined} />);
  fireEvent.change(screen.getByPlaceholderText("https://example.com/img.jpg"), { target: { value: "https://example.invalid/synthetic.png" } }); fireEvent.click(screen.getByText("EXECUTE"));
  await waitFor(() => expect(state.error).toHaveBeenCalledWith(expect.stringContaining("disabled"))); expect(state.invoke).not.toHaveBeenCalled();
});

it.each(["error", "not_configured", "unknown_tool"])("rejects %s through the manual throwing interface without saving evidence", async status => { state.status=status; render(<ToolRunner tool={tool} onBack={() => undefined} />); fireEvent.change(screen.getByPlaceholderText("https://example.com/img.jpg"), {target:{value:"https://example.invalid/synthetic.png"}}); fireEvent.click(screen.getByText("EXECUTE")); await waitFor(()=>expect(state.error).toHaveBeenCalled()); expect(screen.queryByText("SAVE")).not.toBeInTheDocument(); expect(state.saved).toHaveLength(0); expect(state.success).not.toHaveBeenCalled(); });
