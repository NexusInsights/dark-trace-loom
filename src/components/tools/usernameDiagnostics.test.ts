import { beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock("@/lib/profileLookup", () => ({ lookupProfiles: fixture.lookup }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { allTools } from "./toolDefinitions";
import { executeTool } from "./executeTool";
import { executeOutcome } from "@/lib/toolOutcome";
const tool = allTools.find(item => item.id === "username-search")!;
const checks = () => [
  { platform:"GitHub",sourceUrl:"https://api.github.com/users/fixture",status:"unavailable",reason:"Provider returned HTTP 429" },
  { platform:"DEV Community",sourceUrl:"https://dev.to/api/users/by_username?url=fixture",status:"unavailable",reason:"Provider body was invalid, oversized, cancelled or timed out" },
];
beforeEach(() => { fixture.lookup.mockReset(); fixture.lookup.mockResolvedValue({schemaVersion:2,status:"error",username:"fixture",retrievedAt:"2026-11-04T00:00:00Z",profiles:[],checks:checks()}); });
it("retains per-provider reasons through the actual manual throwing contract", async () => {
  await expect(executeTool(tool,{profile_url:"https://github.com/fixture"})).rejects.toThrow("GitHub: Provider returned HTTP 429");
  await expect(executeTool(tool,{profile_url:"https://github.com/fixture"})).rejects.toThrow("DEV Community: Provider body was invalid");
});
it("retains failed-source diagnostics as error rather than a successful empty account result", async () => {
  const result=await executeOutcome(tool,{username:"fixture"});expect(result.status).toBe("error");expect(result.summary).toContain("HTTP 429");expect(result.summary).toContain("no account existence was established");
});
it("bounds and normalizes unavailable-source text, including a missing provider reason",async()=>{
  fixture.lookup.mockResolvedValue({status:"error",username:"fixture",profiles:[],checks:Array.from({length:10},(_,i)=>({platform:`Fixture ${i}`,status:"unavailable",reason:i===0?undefined:"  SYNTHETIC\n"+"x".repeat(2000)}))});
  const result=await executeOutcome(tool,{username:"fixture"});expect(result.status).toBe("error");expect(result.summary.length).toBeLessThanOrEqual(1000);expect(result.summary).not.toContain("\n");expect(result.summary).toContain("no provider reason supplied");expect(result.summary).toContain("Fixture 9:");
});
