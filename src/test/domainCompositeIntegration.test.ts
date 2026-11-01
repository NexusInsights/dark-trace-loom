// @vitest-environment node
import { beforeEach, afterEach, afterAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";
import ts from "typescript";
import { parsePhoneNumberFromString } from "libphonenumber-js/min";
import { safeFetch } from "../../supabase/functions/_shared/safeFetch";
const state = vi.hoisted(() => ({
  scenario: "success", handler: null as unknown as (request: Request) => Promise<Response>,
  writes: [] as { table: string; operation: string; payload: Record<string, unknown> }[],
  traffic: [] as string[], inputs: { domain: "example.com" } as Record<string, unknown>, selectedTool: "domain-intel",
  invoke: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  functions: { invoke: state.invoke },
  auth: { getUser: async () => ({ data: { user: { id: "11111111-1111-4111-8111-111111111111" } }, error: null }) },
  from: (table: string) => {
    let operation = "read";
    const result = () => ({ error: null, data: table === "pipelines" && operation === "read"
      ? { user_id: "11111111-1111-4111-8111-111111111111", tool_sequence: [state.selectedTool], input_params: state.inputs, target_case_id: "fixture-case" }
      : table === "cases" && operation === "read" ? { id: "fixture-case", owner_id: "11111111-1111-4111-8111-111111111111" } : operation === "read" ? null : { id: "fixture-run" } });
    const query = { select: () => query, eq: () => query,
      insert: (payload: Record<string, unknown>) => { operation = "insert"; state.writes.push({ table, operation, payload }); return query; },
      update: (payload: Record<string, unknown>) => { operation = "update"; state.writes.push({ table, operation, payload }); return query; },
      single: async () => result(), maybeSingle: async () => result(), then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
    };
    return query;
  },
} }));
import { allTools } from "@/components/tools/toolDefinitions";
import { executeOutcome as executeTool } from "@/lib/toolOutcome";
import { executePipeline } from "@/lib/pipelineEngine";
const tool = allTools.find(candidate => candidate.id === "domain-intel")!;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const observations: Record<string, unknown>[] = [];
beforeEach(() => {
  state.scenario = "success"; state.writes = []; state.traffic = []; state.inputs = { domain: "example.com" }; state.selectedTool = "domain-intel"; state.invoke.mockReset();
  vi.stubGlobal("Deno", { env: { get: (name: string) => name === "SUPABASE_URL" ? "https://fixture-auth.invalid" : name === "SUPABASE_ANON_KEY" ? "synthetic-test-placeholder" : undefined } });
  const network = vi.fn(async (input: string) => {
    state.traffic.push(input);
    const url = new URL(input);
    if (url.hostname === "fixture-auth.invalid") return json(url.pathname.startsWith("/rest/") ? [] : { id: "11111111-1111-4111-8111-111111111111" });
    if (url.hostname === "cloudflare-dns.com") return json({ Answer: [{ type: 1, data: state.scenario === "private-dns" && url.searchParams.get("name") === "rdap.org" ? "127.0.0.1" : "93.184.215.14" }] });
    if (url.hostname === "rdap.org") {
      if (["rdap-failure", "all-failure"].includes(state.scenario)) return json({}, 503);
      if (state.scenario === "private-redirect") return new Response(null, { status: 302, headers: { Location: "https://127.0.0.1/private" } });
      if (state.scenario === "oversized-rdap") return new Response("x".repeat(5 * 1024 * 1024 + 1));
      return json({ ldhName: "example.com", handle: "SYNTHETIC-RDAP-HANDLE", nameservers: [{ ldhName: "ns.example.com" }] });
    }
    if (url.hostname === "dns.google") {
      if (["dns-failure", "all-failure"].includes(state.scenario)) return json({ Status: 2 });
      if (state.scenario === "empty-dns") return json({ Status: 3 });
      const type = url.searchParams.get("type");
      const answer = type === "A" ? [{ type: 5, data: "edge.example.net" }, { type: 1, data: state.scenario === "private-answer" ? "10.0.0.1" : "8.8.8.8" }]
        : type === "CNAME" ? [{ type: 5, data: "edge.example.net" }, { type: 1, data: "8.8.8.8" }] : [];
      return json({ Status: 0, Answer: answer });
    }
    throw new Error("Fixture transport blocks all unlisted hosts; no real network exists");
  });
  vi.stubGlobal("fetch", network);
  const source = fs.readFileSync("supabase/functions/_shared/authenticateUser.ts", "utf8").replace(/^export /gm, "") + "\n" + fs.readFileSync("supabase/functions/osint-tools/index.ts", "utf8").replace(/^import .*;\r?\n/gm, "");
  new vm.Script(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText)
    .runInContext(vm.createContext({
      Deno: { serve: (handler: typeof state.handler) => { state.handler = handler; }, env: { get: (name: string) => name === "SUPABASE_URL" ? "https://fixture-auth.invalid" : name === "SUPABASE_ANON_KEY" ? "synthetic-public-key" : undefined } },
      parsePhoneNumberFromString: (phone: string, options: { extract?: boolean }) => parsePhoneNumberFromString(phone, { ...options }),
      boundedFetch: safeFetch, fetch: network, TextDecoder, TextEncoder, Uint8Array, AbortController, Request, Response, Headers, URL, URLSearchParams, FormData, AbortSignal, Error, Date, setTimeout, clearTimeout,
    }));
  state.invoke.mockImplementation(async (_gateway: string, { body }: { body: unknown }) => {
    if (state.scenario === "not-configured") return { data: null, error: { message: "Synthetic HTTP 424", context: json({ status: "not_configured", reason: "SYNTHETIC gateway configuration absent" }, 424) } };
    if (state.scenario === "hosting-not-configured" && (body as { action: string }).action === "ip-geo") return { data: { status: "not_configured", reason: "SYNTHETIC geolocation provider access absent" }, error: null };
    if (state.scenario === "unknown-tool") return { data: null, error: { message: "Synthetic HTTP 400", context: json({ status: "unknown_tool", reason: "SYNTHETIC gateway does not implement this action" }, 400) } };
    // A synthetic configured HTTPS adapter isolates the composite contract. The real
    // handler stays unconfigured; this fixture does not enable any provider.
    const action = (body as { action: string }).action;
    const response = action === "ip-geo" && state.scenario !== "commercial-unconfigured"
      ? state.scenario === "hosting-failure" ? json({ status: "error", reason: "SYNTHETIC provider unavailable" }, 503)
        : json({ ip: "8.8.8.8", country: "SYNTHETIC COUNTRY", isp: "Synthetic HTTPS adapter", source: "synthetic fixture only" })
      : await state.handler(new Request("https://fixture-handler.invalid", { method: "POST", headers: { Authorization: "Bearer synthetic-session-placeholder" }, body: JSON.stringify(body) }));
    const context = response.clone(); const data = await response.json();
    if (state.scenario === "demo") data.status = "demo";
    if (state.scenario === "partial-provider") data.status = "partial";
    if (state.scenario === "malformed-source") { delete data.domain; delete data.ip; }
    return { data, error: response.ok ? null : { message: "Synthetic HTTP " + response.status, context } };
  });
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => {
  const paths = ["src/components/tools/toolDefinitions.ts", "src/components/tools/executeTool.ts", "src/lib/pipelineEngine.ts", "supabase/functions/osint-tools/index.ts", "supabase/functions/_shared/safeFetch.ts"];
  fs.writeFileSync("evidence/domain-composite-acceptance.json", JSON.stringify({
    scope: "Actual manual execution helper, registry, edge handler, safe-fetch guard, and pipeline engine. Synthetic transport/auth and in-memory persistence only. No live provider/DB/UI acceptance.",
    sourceFiles: paths.map(path => ({ path, sha256: crypto.createHash("sha256").update(fs.readFileSync(path)).digest("hex") })),
    observations,
  }, null, 2));
});
describe("Domain Intelligence manual and pipeline integration", () => {
  it.each([
    ["success", "success", "completed", 1],
    ["rdap-failure", "partial", "partial", 0],
    ["dns-failure", "partial", "partial", 0],
    ["hosting-failure", "partial", "partial", 0],
    ["hosting-not-configured", "partial", "partial", 0],
    ["commercial-unconfigured", "partial", "partial", 0],
    ["all-failure", "error", "failed", 0],
    ["not-configured", "not_configured", "not_configured", 0],
    ["unknown-tool", "unknown_tool", "failed", 0],
    ["malformed-source", "error", "failed", 0],
    ["private-answer", "partial", "partial", 0],
    ["private-redirect", "partial", "partial", 0],
    ["private-dns", "partial", "partial", 0],
    ["oversized-rdap", "partial", "partial", 0],
    ["empty-dns", "success", "completed", 1],
    ["demo", "demo", "demo", 0],
    ["partial-provider", "partial", "partial", 0],
  ] as const)("preserves %s through both actual execution paths", async (scenario, manualStatus, runStatus, artifacts) => {
    state.scenario = scenario;
    const manual = await executeTool(tool, state.inputs);
    expect(manual.status).toBe(manualStatus);
    const run = await executePipeline("fixture-pipeline", "11111111-1111-4111-8111-111111111111");
    expect(run.status).toBe(runStatus); expect(run.artifactsCreated).toBe(artifacts);
    expect(state.writes.filter(write => write.table === "artifacts")).toHaveLength(artifacts);
    const saved = state.writes.find(write => write.table === "tool_results")!.payload;
    expect(saved.status).toBe(manualStatus);
    if (scenario === "success") {
      expect((manual.details.dns as { a: string[]; cname: string[] }).a).toEqual(["8.8.8.8"]);
      expect((manual.details.dns as { cname: string[] }).cname).toEqual(["edge.example.net"]);
      expect((manual.details.hosting as { source: string }).source).toBe("synthetic fixture only");
    }
    if (scenario === "commercial-unconfigured") {
      expect((manual.details.source_statuses as { hosting: { status: string; reason: string } }).hosting.status).toBe("not_configured");
      expect((manual.details.source_statuses as { hosting: { reason: string } }).hosting.reason).toContain("approved HTTPS");
    }
    expect(state.traffic.some(url => url.includes("ip-api.com"))).toBe(false);
    expect(state.traffic.some(url => url.startsWith("https://127.0.0.1/"))).toBe(false);
    if (scenario === "demo") expect(manual.summary).toContain("DEMO");
    observations.push({ scenario, manualStatus: manual.status, pipelineStatus: run.status, artifactsCreated: run.artifactsCreated, sourceStatuses: manual.details.source_statuses, syntheticTrafficCount: state.traffic.length, accepted: true });
  });
  it("normalizes a URL input identically through per-tool pipeline inputs", async () => {
    const input = { domain: "https://EXAMPLE.COM./public?fixture=1" };
    const manual = await executeTool(tool, input);
    state.inputs = { "domain-intel": input };
    const run = await executePipeline("fixture-pipeline", "11111111-1111-4111-8111-111111111111");
    expect(manual.details.domain).toBe("example.com"); expect(run.status).toBe("completed");
    expect(state.invoke.mock.calls.every(([, options]) => options.body.params.domain === "example.com" || options.body.action === "ip-geo")).toBe(true);
  });
  it.each(["https://fixture:placeholder@example.com", "ftp://example.com", "localhost", "127.0.0.1", "invalid name"])("rejects unsafe or invalid domain %s before any provider call", async domain => {
    const result = await executeTool(tool, { domain });
    expect(result.status).toBe("error"); expect(state.invoke).not.toHaveBeenCalled(); expect(state.traffic).toHaveLength(0);
  });
  it("returns not-configured for the real IP adapter without any geolocation egress", async () => {
    state.scenario = "commercial-unconfigured";
    const ipTool = allTools.find(candidate => candidate.id === "ip-geolocation")!;
    const manual = await executeTool(ipTool, { ip: "8.8.8.8" });
    expect(manual.status).toBe("not_configured");
    expect(manual.summary).toContain("approved HTTPS");
    expect(state.traffic.filter(url => !url.includes("fixture-auth.invalid"))).toEqual([]);
    state.traffic = []; state.selectedTool = "ip-geolocation"; state.inputs = { ip: "8.8.8.8" };
    const pipeline = await executePipeline("fixture-pipeline", "11111111-1111-4111-8111-111111111111");
    expect(pipeline.status).toBe("not_configured"); expect(pipeline.artifactsCreated).toBe(0);
    expect(state.writes.find(write => write.table === "tool_results")!.payload.status).toBe("not_configured");
    expect(state.traffic.filter(url => !url.includes("fixture-auth.invalid"))).toEqual([]);
  });
  it("requires authentication even when the commercial adapter is unavailable", async () => {
    const response = await state.handler(new Request("https://fixture-handler.invalid", { method: "POST", body: JSON.stringify({ action: "ip-geo", params: { ip: "8.8.8.8" } }) }));
    expect(response.status).toBe(401); expect(state.traffic).toHaveLength(0);
  });
});
