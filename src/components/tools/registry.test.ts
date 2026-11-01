import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ invoke: vi.fn(), user: vi.fn(async () => ({ data: { user: null } })) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: state.invoke }, auth: { getUser: state.user } } }));
import { allTools } from "./toolDefinitions";
import { executeOutcome as executeTool } from "@/lib/toolOutcome";
import { getPipelineTemplates } from "@/lib/pipelineEngine";
beforeEach(() => state.invoke.mockReset());
it("has unique registry IDs and supported template IDs", () => {
  expect(new Set(allTools.map(tool => tool.id)).size).toBe(allTools.length);
  for (const template of getPipelineTemplates()) for (const id of template.tool_sequence) expect(allTools.find(tool => tool.id === id)).toBeDefined();
});
it.each([
  ["dns-query", { domain: "example.com" }, "dns-query", { domain: "example.com" }, { a: ["93.184.215.14"] }],
  ["whois-history", { domain: "example.com" }, "whois", { domain: "example.com" }, { registrar: "IANA", registered: "1995-08-14" }],
  ["github-recon", { username: "public-org" }, "github-recon", { user: "public-org" }, { public_repos: 1, followers: 0 }],
] as const)("uses the manual action for %s", async (id, inputs, action, params, data) => {
  state.invoke.mockResolvedValue({ data, error: null }); expect((await executeTool(allTools.find(tool => tool.id === id)!, inputs)).status).toBe("success");
  expect(state.invoke).toHaveBeenCalledWith("osint-tools", { body: { action, params } });
});
it("preserves unavailable provider status even for an HTTP error response", async () => {
  state.invoke.mockResolvedValue({ data: null, error: { message: "500", context: new Response(JSON.stringify({ status: "not_configured", reason: "Provider absent" })) } });
  expect((await executeTool(allTools.find(tool => tool.id === "dns-query")!, { domain: "example.com" })).status).toBe("not_configured");
});
it("reports partial domain intelligence when one source fails", async () => {
  state.invoke.mockResolvedValueOnce({ data: { error: "RDAP unavailable" }, error: null }).mockResolvedValueOnce({ data: { domain: "example.com", a: [], aaaa: [], mx: [], txt: [], ns: [], cname: [], soa: [] }, error: null });
  expect((await executeTool(allTools.find(tool => tool.id === "domain-intel")!, { domain: "example.com" })).status).toBe("partial");
});
it("runs local utility data without any provider", async () => {
  expect((await executeTool(allTools.find(tool => tool.id === "hash-identifier")!, { hash: "5d41402abc4b2a76b9719d911017c592" })).details.candidates).toContain("MD5");
  expect(state.invoke).not.toHaveBeenCalled();
});
it("keeps in-progress SSL assessment partial", async () => {
  state.invoke.mockResolvedValue({ data: { status: "IN_PROGRESS" }, error: null });
  expect((await executeTool(allTools.find(tool => tool.id === "ssl-inspector")!, { host: "example.com" })).status).toBe("partial");
});
it.each([
  ["email-header-analysis", { headers: "From: example@example.com\nTo: test@example.com\nAuthentication-Results: spf=pass dkim=pass dmarc=pass" }, "relay_hops", 0],
  ["timestamp-decoder", { timestamp: "1700000000" }, "conversions.unix_seconds", 1700000000],
  ["encoder-toolkit", { input: "hello", operation: "b64encode" }, "output", "aGVsbG8="],
  ["radio-lookup", { freq: "144" }, "band", "VHF"],
  ["fingerprint-analyzer", { ua: "Mozilla/5.0 (Windows NT 10.0) Chrome/100.0" }, "browser", "Chrome"],
] as const)("runs the real local utility %s", async (id, inputs, key, value) => {
  const result = await executeTool(allTools.find(tool => tool.id === id)!, inputs);
  expect(result.status).toBe("success"); expect(key.split(".").reduce((data, part) => (data as Record<string, unknown>)[part], result.details as unknown)).toEqual(value); expect(state.invoke).not.toHaveBeenCalled();
});
it("decodes a deterministic JWT fixture without pretending to verify its signature", async () => {
  const token = btoa(JSON.stringify({ alg: "none" })) + "." + btoa(JSON.stringify({ sub: "fixture" })) + ".";
  const result = await executeTool(allTools.find(tool => tool.id === "jwt-decoder")!, { token });
  expect(result.status).toBe("success"); expect(result.details.payload).toEqual({ sub: "fixture" }); expect(state.invoke).not.toHaveBeenCalled();
});
it("keeps opaque browser probes partial without asserting unreachable ports", async () => {
  const network = vi.fn(async () => ({ type: "opaque", status: 0, headers: new Headers() }));
  vi.stubGlobal("fetch", network);
  try {
    const result = await executeTool(allTools.find(tool => tool.id === "port-scanner")!, { host: "example.com" });
    expect(result.status).toBe("partial"); expect((result.details.results as { reachable: unknown }[]).every(r => r.reachable === null)).toBe(true);
  } finally { vi.unstubAllGlobals(); }
});
