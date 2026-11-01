import { describe, it, expect, vi } from "vitest";
import { executeTool, assertToolResult } from "./executeTool";
import type { ToolDefinition } from "./types";
describe("honest execution outcomes", () => {
  it.each(["not_configured","error","unknown_tool","failed"])("rejects %s as a successful result", status => {
    expect(() => assertToolResult({ summary:"Unavailable",details:{status,reason:"Actual provider failure"} })).toThrow("Actual provider failure");
  });
  it("rejects error tags even if a summary exists", () => expect(() => assertToolResult({summary:"Image failed",details:{},tags:["error"]})).toThrow());
  it("validates required inputs before invoking a provider", async () => {
    const process = vi.fn();
    await expect(executeTool({ name:"DNS",fields:[{key:"domain",label:"Domain",required:true}],process } as unknown as ToolDefinition,{})).rejects.toThrow("Domain is required");
    expect(process).not.toHaveBeenCalled();
  });
  it("allows genuine successful negative findings", () => expect(() => assertToolResult({summary:"Provider found no record",details:{status:"success",matches:[]}})).not.toThrow());
});
