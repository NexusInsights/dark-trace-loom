// @vitest-environment node
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";
import ts from "typescript";
import sharp from "sharp";
import { z } from "zod";
import { safeFetch } from "../../supabase/functions/_shared/safeFetch";
import { authenticateUser, boundedJsonBody, RequestAuthenticationError } from "../../supabase/functions/_shared/authenticateUser";
import { authorizeTool } from "../../supabase/functions/_shared/toolPermission";
import * as hashing from "../../supabase/functions/_shared/imageHash";
const state = vi.hoisted(() => ({
  scenario: "ascending.png", handler: null as unknown as (request: Request) => Promise<Response>, invoke: vi.fn(), decoder: vi.fn(), traffic: [] as string[],
  writes: [] as { table: string; payload: Record<string, unknown> }[], inputs: { url: "https://hash-images.example.invalid/synthetic.png" } as Record<string, unknown>,
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  auth: { getUser: async () => ({ data: { user: { id: "fixture-user" } }, error: null }) }, functions: { invoke: state.invoke },
  from: (table: string) => {
    let operation = "read";
    const result = () => ({ error: state.scenario === "save-denied" && table === "tool_results" && operation === "insert" ? { message: "SYNTHETIC RLS denial" } : null,
      data: table === "tool_permissions" ? null : table === "pipelines" && operation === "read" ? { user_id: "fixture-user", tool_sequence: ["reverse-image-hash"], input_params: state.inputs, target_case_id: "fixture-case" } : table === "cases" && operation === "read" ? { id: "fixture-case", owner_id: "fixture-user" } : { id: "fixture-run" } });
    const query = { select: () => query, eq: () => query,
      insert: (payload: Record<string, unknown>) => { operation = "insert"; state.writes.push({ table, payload }); return query; },
      update: (payload: Record<string, unknown>) => { operation = "update"; state.writes.push({ table, payload }); return query; },
      single: async () => result(), maybeSingle: async () => result(), then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
    }; return query;
  },
} }));
import { allTools } from "@/components/tools/toolDefinitions";
import { executeOutcome as executeTool } from "@/lib/toolOutcome";
import { executePipeline } from "@/lib/pipelineEngine";
const tool = allTools.find(candidate => candidate.id === "reverse-image-hash")!;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const fixture = (name: string) => new Uint8Array(fs.readFileSync("src/test/fixtures/image-hash/" + name));
const observations: Record<string, unknown>[] = [];
beforeEach(() => {
  state.scenario = "ascending.png"; state.writes = []; state.traffic = []; state.inputs = { url: "https://hash-images.example.invalid/synthetic.png" }; state.invoke.mockReset(); state.decoder.mockReset();
  vi.stubGlobal("Deno", { env: { get: (name: string) => name === "SUPABASE_URL" ? "https://fixture-auth.invalid" : name === "SUPABASE_ANON_KEY" ? "synthetic-placeholder" : undefined } });
  const transport = vi.fn(async (input: string) => {
    state.traffic.push(input); const url = new URL(input);
    if (url.hostname === "fixture-auth.invalid") return json(url.pathname.startsWith("/rest/") ? [] : { id: "11111111-1111-4111-8111-111111111111", role: "authenticated", is_anonymous: false });
    if (url.hostname === "cloudflare-dns.com") return json({ Answer: [{ type: 1, data: state.scenario === "private-dns" ? "127.0.0.1" : "93.184.215.14" }] });
    if (url.hostname !== "hash-images.example.invalid") throw new Error("Fixture transport rejects all unlisted hosts; no network exists");
    if (state.scenario === "private-redirect") return new Response(null, { status: 302, headers: { Location: "https://127.0.0.1/private" } });
    if (state.scenario === "oversized") return new Response(new Uint8Array(hashing.IMAGE_HASH_MAX_BYTES + 1));
    if (state.scenario === "http-error") return new Response("Synthetic denied", { status: 403 });
    if (state.scenario === "malformed") return new Response("not an image");
    if (state.scenario === "truncated") return new Response(fixture("ascending.png").slice(0, 34));
    if (state.scenario === "pixel-bomb") { const bytes = fixture("constant.png"); new DataView(bytes.buffer).setUint32(16, 8192); return new Response(bytes); }
    if (state.scenario === "invalid-crc") { const bytes = fixture("ascending.png"); bytes[30] ^= 255; return new Response(bytes); }
    if (state.scenario === "duplicate-header") { const bytes = fixture("ascending.png"); return new Response(Buffer.concat([bytes.slice(0, 33), bytes.slice(8, 33), bytes.slice(33)])); }
    if (state.scenario === "animated-png") {
      const bytes = fixture("ascending.png"), chunk = Buffer.alloc(20); chunk.writeUInt32BE(8, 0); chunk.write("acTL", 4); chunk.writeUInt32BE(2, 8);
      let crc = 0xffffffff;
      for (const byte of chunk.subarray(4, 16)) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1; }
      chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 16);
      return new Response(Buffer.concat([bytes.slice(0, 33), chunk, bytes.slice(33)]));
    }
    const name = /\.(png|jpg|webp|gif)$/.test(state.scenario) ? state.scenario : "ascending.png";
    return new Response(fixture(name));
  });
  vi.stubGlobal("fetch", transport);
  state.decoder.mockImplementation(async (bytes: Uint8Array) => {
    // Real existing Sharp decoder, deliberately substituted for unavailable ImageScript.
    const decoded = await sharp(bytes, { limitInputPixels: hashing.IMAGE_HASH_MAX_PIXELS, failOn: "warning" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (state.scenario === "decoder-shape") return { width: decoded.info.width, height: decoded.info.height, bitmap: new Uint8ClampedArray(1) };
    return { width: decoded.info.width, height: decoded.info.height, bitmap: new Uint8ClampedArray(decoded.data) };
  });
  const source = fs.readFileSync("supabase/functions/image-hash/index.ts", "utf8").replace(/^import .*;\r?\n/gm, "");
  new vm.Script(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).runInContext(vm.createContext({
    serve: (handler: typeof state.handler) => { state.handler = handler; }, z, safeFetch, authenticateUser, authorizeTool, boundedJsonBody, RequestAuthenticationError, ...hashing, decode: state.decoder, crypto: crypto.webcrypto,
    Request, Response, Headers, URL, Uint8Array, Error,
  }));
  state.invoke.mockImplementation(async (_gateway: string, { body }: { body: unknown }) => {
    if (state.scenario === "not-configured") return { data: null, error: { message: "Synthetic HTTP 424", context: json({ status: "not_configured", reason: "SYNTHETIC decoder unavailable" }, 424) } };
    const response = await state.handler(new Request("https://fixture-handler.invalid", { method: "POST", headers: { Authorization: "Bearer synthetic-session" }, body: JSON.stringify(body) }));
    const context = response.clone(), data = await response.json();
    if (state.scenario === "demo") data.status = "demo";
    if (state.scenario === "partial") data.status = "partial";
    if (state.scenario === "invalid-hash") data.result.phash = "not-a-hash";
    if (state.scenario === "wrong-source") data.result.url = "https://other.example.invalid/";
    if (state.scenario === "legacy-output") { delete data.result.algorithm; delete data.result.sha256; }
    return { data, error: response.ok ? null : { message: "Synthetic HTTP " + response.status, context } };
  });
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => {
  const paths = ["supabase/functions/image-hash/index.ts", "supabase/functions/_shared/imageHash.ts", "supabase/functions/_shared/safeFetch.ts", "supabase/functions/_shared/requireUser.ts", "src/components/tools/extraTools.ts", "src/components/tools/executeTool.ts", "src/lib/pipelineEngine.ts", "src/test/fixtures/image-hash/manifest.json"];
  fs.writeFileSync("evidence/image-hash-acceptance.json", JSON.stringify({ scope: "Actual handler/hash code, safe-fetch/auth guard, registry/manual/pipeline. Real existing Sharp decode of synthetic local bytes; ImageScript 1.2.17 substituted and not runtime-accepted. No actual network, photographs, external image transmission or production DB/UI.",
    sourceFiles: paths.map(path => ({ path, sha256: crypto.createHash("sha256").update(fs.readFileSync(path)).digest("hex") })), observations }, null, 2));
});
describe("Image perceptual hash acceptance", () => {
  it.each(["ascending.png", "descending.png", "constant.png", "constant.jpg", "checker.png", "transparent-a.png", "transparent-b.png", "unsupported.webp", "unsupported.gif", "malformed", "truncated", "pixel-bomb", "oversized", "invalid-crc", "http-error", "private-dns", "private-redirect", "decoder-shape", "invalid-hash", "wrong-source", "not-configured", "partial", "demo", "save-denied", "legacy-output", "duplicate-header", "animated-png"])("preserves %s across manual and pipeline", async scenario => {
    state.scenario = scenario;
    const success = ["ascending.png", "descending.png", "constant.png", "constant.jpg", "checker.png", "transparent-a.png", "transparent-b.png"].includes(scenario);
    const expected = success || scenario === "save-denied" ? "success" : scenario === "legacy-output" ? "partial" : ["not-configured", "partial", "demo"].includes(scenario) ? scenario.replace("-", "_") : "error";
    const manual = await executeTool(tool, state.inputs); const run = await executePipeline("fixture-pipeline", "fixture-user");
    expect(manual.status).toBe(expected); expect(run.status).toBe(scenario === "save-denied" ? "failed" : success ? "completed" : expected === "error" ? "failed" : expected);
    expect(run.artifactsCreated).toBe(success ? 1 : 0); expect(state.writes.filter(write => write.table === "artifacts")).toHaveLength(success ? 1 : 0);
    expect(state.writes.find(write => write.table === "tool_results")!.payload.status).toBe(expected);
    expect(state.traffic.some(url => url.includes("127.0.0.1"))).toBe(false);
    if (success) {
      const repeated = await executeTool(tool, state.inputs); expect(repeated.details).toEqual(manual.details);
      expect(manual.details.sha256).toBe(crypto.createHash("sha256").update(fixture(scenario)).digest("hex"));
      expect(manual.details.algorithm).toBe(hashing.IMAGE_HASH_ALGORITHM); expect(manual.details.url).toBe(state.inputs.url);
      if (scenario === "ascending.png") expect(manual.details.dhash).toBe("ffffffffffffffff");
      if (["descending.png", "constant.png", "constant.jpg", "transparent-a.png", "transparent-b.png"].includes(scenario)) expect(manual.details.dhash).toBe("0000000000000000");
      if (["constant.png", "constant.jpg", "transparent-a.png", "transparent-b.png"].includes(scenario)) expect(manual.details.phash).toBe("0000000000000000");
    }
    if (["unsupported.webp", "unsupported.gif", "malformed", "truncated", "pixel-bomb", "oversized", "invalid-crc", "not-configured", "duplicate-header", "animated-png"].includes(scenario)) expect(state.decoder).not.toHaveBeenCalled();
    if (scenario === "demo") expect(manual.summary).toContain("DEMO");
    if (scenario === "legacy-output") expect(manual.summary).toContain("provenance unverified");
    observations.push({ scenario, manualStatus: manual.status, pipelineStatus: run.status, artifactsCreated: run.artifactsCreated, phash: manual.details.phash, dhash: manual.details.dhash, sha256: manual.details.sha256, reason: manual.details.reason, decoderCalls: state.decoder.mock.calls.length, actualLocalDecoder: "Sharp adapter; not production ImageScript runtime", accepted: true });
  });
  it("rejects unsupported methods and unauthorized users before fetching/decoding", async () => {
    expect((await state.handler(new Request("https://fixture-handler.invalid"))).status).toBe(405);
    expect((await state.handler(new Request("https://fixture-handler.invalid", { method: "POST", body: JSON.stringify(state.inputs) }))).status).toBe(401);
    expect(state.traffic).toHaveLength(0); expect(state.decoder).not.toHaveBeenCalled();
  });
  it.each(["http://hash-images.example.invalid/x", "https://127.0.0.1/x", "https://[::1]/x", "https://fixture:placeholder@hash-images.example.invalid/x"])("blocks unsafe URL %s", async url => {
    const manual = await executeTool(tool, { url }); expect(manual.status).toBe("error"); expect(state.decoder).not.toHaveBeenCalled();
    expect(state.traffic.every(item => item.startsWith("https://fixture-auth.invalid/"))).toBe(true);
  });
  it("matches an independent direct 2D DCT oracle for a decoded checkerboard", async () => {
    state.scenario = "checker.png"; const result = await executeTool(tool, state.inputs);
    const coefficients: number[] = [];
    for (let v = 0; v < 8; v++) for (let u = 0; u < 8; u++) {
      if (!u && !v) continue; let sum = 0;
      for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) sum += ((x + y) % 2 ? 255 : 0) * Math.cos((2 * x + 1) * u * Math.PI / 64) * Math.cos((2 * y + 1) * v * Math.PI / 64);
      const value = sum * (u ? 1 : 1 / Math.sqrt(2)) * (v ? 1 : 1 / Math.sqrt(2)) / 16;
      coefficients.push(Math.abs(value) < 1e-9 ? 0 : value);
    }
    const median = [...coefficients].sort((a, b) => a - b)[31]; const bits = coefficients.map(v => v > median ? 1 : 0).concat(0);
    let expected = ""; for (let i = 0; i < 64; i += 4) expected += parseInt(bits.slice(i, i + 4).join(""), 2).toString(16);
    expect(result.details.phash).toBe(expected);
  });
});
