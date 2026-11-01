import { describe, it, expect, vi } from "vitest";
import { mapToolInputs, ToolExecutionError } from "./executeTool";
import { executeOutcome as executeTool } from "@/lib/toolOutcome";
import type { ToolDefinition } from "./types";
const tool = (process = vi.fn(async () => ({ summary: "real data", details: {} }))) => ({ id: "fixture", fields: [{ key: "user", label: "User", required: true }, { key: "mode", label: "Mode", type: "select", options: [{ value: "first", label: "First" }] }], process } as unknown as ToolDefinition);
describe("shared execution", () => {
  it("maps legacy input and the visible select default without forwarding unrelated objects", () => {
    expect(mapToolInputs(tool(), { username: "  public-org  ", unrelated: { data: "x" } })).toEqual({ user: "public-org", mode: "first" });
  });
  it.each([{ user: "" }, { user: {} }, { user: ["x"] }, { user: "ok", mode: "unknown" }, { user: "x".repeat(50001) }])("rejects invalid inputs before provider calls", async params => {
    const definition = tool(); expect((await executeTool(definition, params)).status).toBe("error"); expect(definition.process).not.toHaveBeenCalled();
  });
  it.each(["not_configured", "error", "unknown_tool", "partial"] as const)("preserves structured %s", async status => {
    const definition = tool(vi.fn(async () => ({ summary: status, details: { status, reason: "test" } })));
    expect((await executeTool(definition, { user: "benign" })).status).toBe(status);
  });
  it("preserves typed unavailable errors", async () => {
    const definition = tool(vi.fn(async () => { throw new ToolExecutionError("Missing provider", "not_configured"); }));
    expect((await executeTool(definition, { user: "benign" })).status).toBe("not_configured");
  });
  it("does not confuse a provider business status with execution status", async () => {
    const definition = tool(vi.fn(async () => ({ summary: "record", details: { status: ["active"] } })));
    expect((await executeTool(definition, { user: "benign" })).status).toBe("success");
  });
  it("labels demo output explicitly", async () => {
    const definition = tool(vi.fn(async () => ({ summary: "sample", details: { demo: true } })));
    const result = await executeTool(definition, { user: "benign" }); expect(result.status).toBe("demo"); expect(result.summary).toContain("DEMO");
  });
  it("rejects array details before treating them as a successful record", async () => {
    const definition = { ...tool(), process: async () => ({ summary: "Synthetic malformed response", details: [] }) } as unknown as ToolDefinition;
    expect((await executeTool(definition, { user: "synthetic" })).status).toBe("error");
  });
  it("rejects an unknown explicit execution status", async () => {
    const definition = { ...tool(), process: async () => ({ status: "unexpected", summary: "Synthetic malformed state", details: {} }) } as unknown as ToolDefinition;
    expect((await executeTool(definition, { user: "synthetic" })).status).toBe("error");
  });
  it("labels explicit demo status even without demo tags", async () => {
    const definition = { ...tool(), process: async () => ({ status: "demo", summary: "Synthetic sample", details: {} }) } as unknown as ToolDefinition;
    const result = await executeTool(definition, { user: "synthetic" }); expect(result.status).toBe("demo"); expect(result.summary).toContain("DEMO");
  });
});
