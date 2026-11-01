import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import fs from "node:fs";
import crypto from "node:crypto";
import vm from "node:vm";

import ts from "typescript";
import type { ReactNode } from "react";
import type { ToolDefinition } from "@/components/tools/types";
const state = vi.hoisted(() => ({
  actor: "owner" as string | null, caller: "owner", caseId: "owned" as string | null, pipelineOwner: "owner", status: "success", scenario: "",
  owners: { owned: "owner", foreign: "other" } as Record<string, string>, queries: 0, calls: 0, error: vi.fn(), success: vi.fn(),
  attempts: [] as { table: string; op: string; payload: Record<string, unknown> }[], rows: [] as { table: string; payload: Record<string, unknown> }[],
  db: null as unknown as { auth: { getUser: () => Promise<unknown> }; from: (table: string) => unknown },
}));
const tool = { id: "fixture-tool", name: "SYNTHETIC OWNERSHIP TOOL", icon: () => null, category: "Fixture", fields: [{ key: "value", label: "Value", placeholder: "synthetic input", required: true }],
  process: async () => {
    state.calls++;
    if (state.scenario === "mid-run-revocation" && state.calls === 2) state.owners.owned = "other";
    return { status: state.status, summary: "SYNTHETIC RESULT", details: { source: "local fixture only" } };
  },
} as unknown as ToolDefinition;
vi.mock("@/components/tools/toolDefinitions", () => ({ allTools: [{ id: "fixture-tool", name: "Fixture", fields: [{ key: "value", label: "Value", required: true }], process: async () => {
  state.calls++;
  if (state.scenario === "mid-run-revocation" && state.calls === 2) state.owners.owned = "other";
  return { status: state.status, summary: "SYNTHETIC RESULT", details: { source: "local fixture only" } };
} }] }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { getUser: () => state.db.auth.getUser() }, from: (table: string) => state.db.from(table) } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: state.caller } }) }));
vi.mock("@/hooks/useSubscription", () => ({ useSubscription: () => ({ plan: "professional" }) }));
vi.mock("@/hooks/useUsageTracking", () => ({ useUsageTracking: () => ({ dailyTotal: 0, recordExecution: async () => undefined }) }));
vi.mock("@/hooks/useAuditLog", () => ({ useAuditLog: () => ({ log: async () => undefined }) }));
vi.mock("@/hooks/useInvestigationData", () => ({ useCases: () => ({ data: ["owned", "foreign", "missing"].map(id => ({ id, title: id })) }) }));
vi.mock("@/lib/rateLimiter", () => ({ checkRateLimit: () => ({ allowed: true }) }));
vi.mock("@/components/intel", () => ({ GlassPanel: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("sonner", () => ({ toast: { error: state.error, success: state.success } }));
import { ToolRunner } from "@/components/tools/ToolRunner";
import { executeOutcome as executeTool } from "@/lib/toolOutcome";
import { executePipeline } from "@/lib/pipelineEngine";

// This repository stub models the source SQL's permissive OR for tool_results.
// It deliberately is not PostgreSQL, applied policies, transactions, or RLS proof.
function repository() {
  return {
    auth: { getUser: async () => ({ data: { user: state.actor ? { id: state.actor } : null }, error: state.scenario === "auth-partial-error" ? { message: "SYNTHETIC auth lookup failed" } : null }) },
    from: (table: string) => {
      let op = "read"; let payload: Record<string, unknown> = {}; const filters: Record<string, unknown> = {};
      const result = () => {
        if (op === "read") {
          if (table === "tool_permissions") return { data: { allowed: true }, error: null };
          if (table === "cases") {
            state.queries++; const id = String(filters.id); const owner = state.owners[id];
            const data = owner && (filters.owner_id === owner || state.scenario === "leaky-case-response") ? { id, owner_id: owner } : null;
            return { data, error: state.scenario === "case-partial-error" ? { message: "SYNTHETIC case lookup failed" } : null };
          }
          if (table === "pipelines") return { data: { user_id: state.pipelineOwner, tool_sequence: state.scenario === "mid-run-revocation" ? ["fixture-tool", "fixture-tool"] : ["fixture-tool"], target_case_id: state.caseId, input_params: { value: "synthetic" } }, error: null };
          return { data: null, error: null };
        }
        const caseOwner = state.owners[String(payload.case_id)];
        const allowed = table === "tool_results" ? state.actor !== null && (payload.user_id === state.actor || caseOwner === state.actor)
          : table === "artifacts" ? caseOwner === state.actor : true;
        if (!allowed || state.scenario === "write-denied" && table === "tool_results") return { data: null, error: { message: "SYNTHETIC repository denied write" } };
        state.rows.push({ table, payload });
        if (state.scenario === "artifact-revocation" && table === "tool_results") state.owners.owned = "other";
        return { data: { id: "fixture-run" }, error: null };
      };
      const query = { select: () => query, eq: (key: string, value: unknown) => { filters[key] = value; return query; },
        insert: (value: Record<string, unknown>) => { op = "insert"; payload = value; state.attempts.push({ table, op, payload }); return query; },
        update: (value: Record<string, unknown>) => { op = "update"; payload = value; state.attempts.push({ table, op, payload }); return query; },
        single: async () => result(), maybeSingle: async () => result(), then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
      }; return query;
    },
  };
}
const observations: Record<string, unknown>[] = [];
const baseline = "7fc3ed2d47eafe041a14f80297138738c70210e5";
beforeEach(() => { cleanup(); state.actor = "owner"; state.caller = "owner"; state.caseId = "owned"; state.pipelineOwner = "owner"; state.status = "success"; state.scenario = ""; state.owners = { owned: "owner", foreign: "other" }; state.queries = 0; state.calls = 0; state.attempts = []; state.rows = []; state.error.mockReset(); state.success.mockReset(); state.db = repository(); });
afterAll(() => {
  const paths = ["src/lib/ownedToolResults.ts", "src/lib/pipelineEngine.ts", "src/components/tools/ToolRunner.tsx", "supabase/migrations/20260312034027_e042967e-54fa-4fe0-b929-6efc50d89ec2.sql"];
  fs.writeFileSync("evidence/ownership-acceptance.json", JSON.stringify({ scope: "Actual saved baseline handlers replayed against source-policy repository stub, then actual current React manual handler and pipeline engine. Synthetic actors/cases/transactions only; no actual database/RLS/live records/session or network. Client check does not fix server policies or eliminate check/write races.", baseline,
    sourceFiles: paths.map(path => ({ path, sha256: crypto.createHash("sha256").update(fs.readFileSync(path)).digest("hex") })), observations }, null, 2));
});
it("reproduces the preserved source gap through both baseline entry paths", async () => {
  state.caseId = "foreign"; state.status = "partial";
  const manual = fs.readFileSync("src/test/fixtures/retained-baseline/ToolRunner.tsx.txt", "utf8");
  const start = manual.indexOf("  const handleSave = async"); const end = manual.indexOf("\n  return (", start);
  const source = manual.slice(start, end) + "\n globalThis.run = handleSave;";
  const context = vm.createContext({ result: { status: "partial", summary: "SYNTHETIC", details: {} }, inputs: { value: "synthetic" }, user: { id: "owner" }, plan: "professional", selectedCaseId: "foreign", tool,
    checkFeatureGate: () => ({ allowed: true }), supabase: state.db, setGateBlock: () => undefined, setSaving: () => undefined, setSaved: () => undefined, toast: { success: state.success, error: state.error }, Error });
  new vm.Script(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText).runInContext(context);
  await context.run(); expect(state.rows.filter(row => row.table === "tool_results")).toHaveLength(1);
  expect(state.rows[0].payload).toMatchObject({ user_id: "owner", case_id: "foreign", status: "partial" });
  state.rows = []; state.attempts = [];
  const oldPipeline = fs.readFileSync("src/test/fixtures/retained-baseline/pipelineEngine.ts.txt", "utf8"); const exports: Record<string, unknown> = {};
  new vm.Script(ts.transpileModule(oldPipeline, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText).runInContext(vm.createContext({ exports,
    require: (id: string) => id.includes("supabase/client") ? { supabase: state.db } : id.includes("toolDefinitions") ? { allTools: [tool] } : { executeTool },
    Error, Date,
  }));
  const outcome = await (exports.executePipeline as typeof executePipeline)("fixture-pipeline", "owner");
  expect(outcome.status).toBe("partial"); expect(state.rows.filter(row => row.table === "tool_results")).toHaveLength(1);
  expect(state.rows.find(row => row.table === "tool_results")!.payload.case_id).toBe("foreign"); expect(outcome.artifactsCreated).toBe(0);
  observations.push({ scenario: "baseline permissive source-policy reproduction", manualForeignCaseRows: 1, pipelineForeignCaseRows: 1, actualSQL: false, baseline, accepted: true });
});
const manualRunAndSave = async () => {
  render(<ToolRunner tool={tool} onBack={() => undefined} />); fireEvent.change(screen.getByPlaceholderText("synthetic input"), { target: { value: "synthetic" } });
  fireEvent.click(screen.getByText("EXECUTE")); await screen.findByText("SYNTHETIC RESULT");
  fireEvent.change(screen.getByRole("combobox"), { target: { value: state.caseId ?? "" } }); fireEvent.click(screen.getByText("SAVE"));
};
it.each(["unrelated-user", "unrelated-case", "missing-case", "case-partial-error", "auth-partial-error", "missing-session", "leaky-case-response"])("blocks %s on actual manual and pipeline entry paths", async scenario => {
  state.scenario = scenario;
  if (scenario === "unrelated-user") state.actor = "other";
  if (["unrelated-case", "leaky-case-response"].includes(scenario)) state.caseId = "foreign";
  if (scenario === "missing-case") state.caseId = "missing";
  if (scenario === "missing-session") state.actor = null;
  await manualRunAndSave(); await waitFor(() => expect(state.error).toHaveBeenCalled()); expect(screen.queryByText("SAVED")).not.toBeInTheDocument();
  expect(state.attempts.filter(row => ["tool_results", "artifacts"].includes(row.table))).toHaveLength(0);
  state.calls = 0; state.rows = []; state.attempts = [];
  await expect(executePipeline("fixture-pipeline", "owner")).rejects.toThrow(/ownership|authenticated/);
  expect(state.calls).toBe(0); expect(state.attempts).toHaveLength(0);
  observations.push({ scenario, manual: "unsaved; ownership reason rendered", pipeline: "rejected before provider/run", caseWriteAttempts: 0, accepted: true });
});
it.each(["owned", "standalone", "partial-result"])("retains lawful %s writes/statuses on both paths", async scenario => {
  if (scenario === "standalone") state.caseId = null;
  if (scenario === "partial-result") state.status = "partial";
  await manualRunAndSave(); await screen.findByText("SAVED"); expect(state.rows.find(row => row.table === "tool_results")!.payload).toMatchObject({ user_id: "owner", case_id: state.caseId, status: state.status });
  state.rows = []; state.attempts = []; const run = await executePipeline("fixture-pipeline", "owner");
  expect(run.status).toBe(state.status === "partial" ? "partial" : "completed"); expect(run.artifactsCreated).toBe(scenario === "owned" ? 1 : 0);
  expect(state.rows.find(row => row.table === "tool_results")!.payload.status).toBe(state.status);
  if (scenario === "standalone") expect(state.queries).toBe(0);
  observations.push({ scenario, manual: "saved with verified owner", pipeline: run.status, artifactsCreated: run.artifactsCreated, accepted: true });
});
it("fails an unrelated returned pipeline even if a repository ignores its user filter", async () => {
  state.pipelineOwner = "other"; await expect(executePipeline("fixture-pipeline", "owner")).rejects.toThrow("Pipeline ownership"); expect(state.calls).toBe(0); expect(state.attempts).toHaveLength(0);
});
it("retains denied writes as unsaved/failed on both paths", async () => {
  state.scenario = "write-denied"; await manualRunAndSave(); await waitFor(() => expect(state.error).toHaveBeenCalledWith("SYNTHETIC repository denied write"));
  expect(screen.queryByText("SAVED")).not.toBeInTheDocument(); state.rows = []; const run = await executePipeline("fixture-pipeline", "owner");
  expect(run.status).toBe("failed"); expect(run.artifactsCreated).toBe(0); expect(state.rows.some(row => row.table === "tool_results" || row.table === "artifacts")).toBe(false);
});
it("keeps a mid-run ownership revocation partial without a second case write", async () => {
  state.scenario = "mid-run-revocation"; const run = await executePipeline("fixture-pipeline", "owner");
  expect(run.status).toBe("partial"); expect(run.artifactsCreated).toBe(1); expect(state.rows.filter(row => row.table === "tool_results")).toHaveLength(1);
  expect(state.rows.filter(row => row.table === "artifacts")).toHaveLength(1);
});
it("rechecks ownership before artifact creation after a legitimate result insert", async () => {
  state.scenario = "artifact-revocation"; const run = await executePipeline("fixture-pipeline", "owner");
  expect(run.status).toBe("failed"); expect(run.artifactsCreated).toBe(0); expect(state.attempts.some(row => row.table === "artifacts")).toBe(false);
});
