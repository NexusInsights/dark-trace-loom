import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  sequence: ["dns_lookup"], params: { domain: "example.com" } as Record<string, unknown>, caseId: null as string | null,
  writes: [] as { table: string; op: string; payload: Record<string, unknown> }[], filters: [] as [string, unknown][],
  failureTable: "", failureOp: "", failedOnce: false,
  provider: vi.fn(async () => ({ summary: "DNS", details: { a: ["93.184.215.14"] } as Record<string, unknown> })),
}));
vi.mock("@/components/tools/toolDefinitions", () => ({ allTools: [
  { id: "dns-query", name: "DNS", fields: [{ key: "domain", label: "Domain", required: true }], process: state.provider },
  ...["username-search", "whois-history", "subdomain-enum", "breach-lookup"].map(id => ({ id, name: id, fields: [], process: state.provider })),
] }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { getUser: async () => ({ data: { user: { id: "u" } }, error: null }) }, from: (table: string) => {
  let op = "read", payload: Record<string, unknown> = {};
  const outcome = () => {
    if (table === "tool_permissions") return { data: null, error: null };
    if (!state.failedOnce && table === state.failureTable && op === state.failureOp) { state.failedOnce = true; return { data: null, error: { message: "database denied" } }; }
    return { error: null, data: op === "read" && table === "pipelines" ? { user_id: "u", tool_sequence: state.sequence, input_params: state.params, target_case_id: state.caseId } : op === "read" && table === "cases" ? { id: state.caseId, owner_id: "u" } : { id: "run-1" } };
  };
  const builder = { select: () => builder, eq: (key: string, value: unknown) => { state.filters.push([key, value]); return builder; },
    insert: (value: Record<string, unknown>) => { op = "insert"; payload = value; state.writes.push({ table, op, payload }); return builder; },
    update: (value: Record<string, unknown>) => { op = "update"; payload = value; state.writes.push({ table, op, payload }); return builder; },
    single: async () => outcome(), maybeSingle: async () => outcome(), then: (resolve: (value: unknown) => unknown) => Promise.resolve(outcome()).then(resolve) };
  return builder;
} } }));
import { executePipeline, getPipelineTemplates, pipelineStatus, resolvePipelineTool } from "./pipelineEngine";
beforeEach(() => { state.sequence = ["dns_lookup"]; state.params = { domain: "example.com" }; state.caseId = null; state.writes = []; state.filters = []; state.failureTable = ""; state.failedOnce = false; state.provider.mockReset(); state.provider.mockResolvedValue({ summary: "DNS", details: { a: ["93.184.215.14"] } }); });
const terminal = () => state.writes.filter(write => write.table === "pipeline_runs" && write.op === "update").at(-1)!.payload;
describe("pipeline execution contract", () => {
  it("all templates resolve and use manual schedules with editable inputs", () => {
    for (const template of getPipelineTemplates()) { expect(template.schedule).toBe("manual"); expect(template.input_params).toBeDefined(); for (const id of template.tool_sequence) expect(resolvePipelineTool(id)).toBeDefined(); }
    for (const id of ["social_analyzer", "email_validator", "reverse_image"]) expect(resolvePipelineTool(id)).toBeUndefined();
  });
  it("resolves legacy IDs to manual implementations and does not count saved results as artifacts", async () => {
    const result = await executePipeline("p", "u"); expect(result.status).toBe("completed"); expect(result.artifactsCreated).toBe(0);
    expect(state.provider).toHaveBeenCalledWith({ domain: "example.com" }); expect(terminal().status).toBe("completed"); expect(state.filters).toContainEqual(["user_id", "u"]);
  });
  it("merges shared and canonical per-tool inputs", async () => {
    state.params = { domain: "shared.example", "dns-query": { domain: "example.com" } }; await executePipeline("p", "u"); expect(state.provider).toHaveBeenCalledWith({ domain: "example.com" });
  });
  it("accepts per-tool inputs keyed by legacy ID", async () => {
    state.params = { dns_lookup: { domain: "example.com" } }; await executePipeline("p", "u"); expect(state.provider).toHaveBeenCalledWith({ domain: "example.com" });
  });
  it.each(["error", "not_configured", "unknown_tool", "partial"] as const)("never completes %s as success", async status => {
    state.caseId = "case"; state.provider.mockResolvedValue({ summary: status, details: { status } });
    const result = await executePipeline("p", "u"); expect(result.status).not.toBe("completed"); expect((terminal().results as { status: string }[])[0].status).toBe(status);
    expect(state.writes.some(write => write.table === "artifacts")).toBe(false);
  });
  it("preserves mixed success/error as partial", async () => {
    state.sequence = ["dns-query", "social_analyzer"]; const result = await executePipeline("p", "u"); expect(result.status).toBe("partial"); expect((terminal().results as { status: string }[]).map(x => x.status)).toEqual(["success", "unknown_tool"]);
  });
  it("counts an actual artifact insert", async () => { state.caseId = "case"; expect((await executePipeline("p", "u")).artifactsCreated).toBe(1); });
  it("links only explicit valid entities and counts confirmed observations", async () => {
    state.provider.mockResolvedValue({ summary: "fixture", details: { entities: [{ type: "domain", value: "example.com" }, { type: "domain" }] } });
    expect((await executePipeline("p", "u")).entitiesLinked).toBe(1);
  });
  it("preserves entity-persistence failures as partial", async () => {
    state.provider.mockResolvedValue({ summary: "fixture", details: { entities: [{ type: "domain", value: "example.com" }] } });
    state.failureTable = "entity_observations"; state.failureOp = "insert";
    const result = await executePipeline("p", "u"); expect(result.status).toBe("partial"); expect(result.entitiesLinked).toBe(0);
  });
  it("never promotes demo data to case evidence", async () => {
    state.caseId = "case"; state.provider.mockResolvedValue({ summary: "sample", details: { demo: true, entities: [{ type: "domain", value: "example.com" }] } });
    const result = await executePipeline("p", "u"); expect(result.status).toBe("demo"); expect(result.artifactsCreated).toBe(0); expect(result.entitiesLinked).toBe(0);
  });
  it.each(["tool_results", "artifacts"])("reports %s persistence failure", async table => {
    state.caseId = "case"; state.failureTable = table; state.failureOp = "insert"; expect((await executePipeline("p", "u")).status).toBe("failed"); expect(terminal().artifacts_created).toBe(0);
  });
  it("reports final run persistence failure and attempts failed-state save", async () => {
    state.failureTable = "pipeline_runs"; state.failureOp = "update"; await expect(executePipeline("p", "u")).rejects.toThrow("Run persistence failed"); expect(terminal().status).toBe("failed"); expect(terminal().results).toHaveLength(1);
  });
  it("does not overwrite a saved run on last-run metadata failure", async () => {
    state.failureTable = "pipelines"; state.failureOp = "update"; const result = await executePipeline("p", "u"); expect(result.status).toBe("completed"); expect(result.warning).toContain("not saved"); expect(terminal().status).toBe("completed");
  });
  it("never calls providers for missing required inputs", async () => {
    state.params = {}; expect((await executePipeline("p", "u")).status).toBe("failed"); expect(state.provider).not.toHaveBeenCalled();
  });
  it("rejects an empty pipeline before creating a run", async () => { state.sequence = []; await expect(executePipeline("p", "u")).rejects.toThrow("at least one"); expect(state.writes).toHaveLength(0); });
  it.each([[[ "success" ], "completed"], [["error"], "failed"], [["partial"], "partial"], [["not_configured"], "not_configured"], [["demo"], "demo"], [[], "failed"]] as const)("aggregates %j as %s", (statuses, expected) => expect(pipelineStatus([...statuses])).toBe(expected));
});
