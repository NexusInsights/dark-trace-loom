// @vitest-environment node
import { afterEach, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import crypto from "node:crypto";
const state = vi.hoisted(() => ({
  scenario: "zero-gps", traffic: [] as string[], invoke: vi.fn(), inputs: { image_url: "https://images.example.invalid/fixture.jpg", notes: "SYNTHETIC IMAGE" } as Record<string, unknown>,
  writes: [] as { table: string; payload: Record<string, unknown> }[],
}));
vi.mock("exifr", async importOriginal => {
  const actual = await importOriginal<typeof import("exifr")>();
  return { default: { ...actual.default, parse: (buffer: ArrayBuffer, options: Parameters<typeof actual.default.parse>[1]) => {
    if (state.scenario === "parser-error") return Promise.reject(new Error("SYNTHETIC parser exception"));
    return actual.default.parse(buffer, options);
  } } };
});
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  functions: { invoke: state.invoke }, auth: { getUser: async () => ({ data: { user: { id: "fixture-user" } }, error: null }) },
  from: (table: string) => {
    let operation = "read";
    const result = () => ({ error: null, data: table === "pipelines" && operation === "read"
      ? { user_id: "fixture-user", tool_sequence: ["image-metadata"], input_params: state.inputs, target_case_id: "fixture-case" }
      : table === "cases" && operation === "read" ? { id: "fixture-case", owner_id: "fixture-user" } : operation === "read" ? null : { id: "fixture-run" } });
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
import { IMAGE_MAX_BYTES, IMAGE_TIMEOUT_MS } from "@/components/tools/imageMetadata";
const tool = allTools.find(candidate => candidate.id === "image-metadata")!;
const fixture = (name: string) => new Uint8Array(fs.readFileSync("src/test/fixtures/images/" + name));
const json = (data: unknown) => new Response(JSON.stringify(data));
const observations: Record<string, unknown>[] = [];
beforeEach(() => {
  state.scenario = "zero-gps"; state.traffic = []; state.writes = []; state.invoke.mockReset();
  state.inputs = { image_url: "https://images.example.invalid/fixture.jpg", notes: "SYNTHETIC IMAGE" };
  vi.stubGlobal("fetch", vi.fn(async (input: string, options: RequestInit) => {
    state.traffic.push(input); const url = new URL(input);
    if (url.hostname === "cloudflare-dns.com") return json({ Answer: [{ type: 1, data: state.scenario === "private-dns" ? "10.0.0.1" : "93.184.215.14" }] });
    if (url.hostname !== "images.example.invalid") throw new Error("Fixture transport blocks unlisted hosts; no actual network exists");
    expect(options.credentials).toBe("omit"); expect(options.redirect).toBe("manual"); expect(options.signal).toBeDefined();
    if (state.scenario === "http-error") return new Response("Denied", { status: 403 });
    if (state.scenario === "cors-error") throw new TypeError("SYNTHETIC CORS rejection");
    if (state.scenario === "invalid-bytes") return new Response("<html>not an image</html>");
    if (state.scenario === "truncated-png") return new Response(fixture("container.png").slice(0, 34));
    if (state.scenario === "empty-jpeg") return new Response(new Uint8Array([255, 216, 255, 217]));
    if (state.scenario === "oversized") return new Response(new Uint8Array(IMAGE_MAX_BYTES + 1));
    if (state.scenario === "private-redirect") return new Response(null, { status: 302, headers: { Location: "https://127.0.0.1/private" } });
    if (state.scenario === "redirect-loop") return new Response(null, { status: 302, headers: { Location: "/loop" } });
    if (state.scenario === "no-exif") return new Response(fixture("no-exif.jpg"), { headers: { "Content-Type": "image/jpeg" } });
    if (state.scenario === "png") return new Response(fixture("container.png"), { headers: { "Content-Type": "image/png" } });
    if (state.scenario === "invalid-gps") return new Response(fixture("invalid-gps.jpg"), { headers: { "Content-Type": "image/jpeg" } });
    return new Response(fixture("zero-gps.jpg"), { headers: { "Content-Type": "image/jpeg" } });
  }));
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => {
  const paths = ["src/components/tools/imageMetadata.ts", "src/components/tools/toolDefinitions.ts", "src/components/tools/executeTool.ts", "src/lib/pipelineEngine.ts", "supabase/functions/_shared/safeFetch.ts", "src/test/fixtures/images/manifest.json"];
  fs.writeFileSync("evidence/image-metadata-acceptance.json", JSON.stringify({
    scope: "Actual manual helper, registry, exifr byte parser, safe-fetch guard, and pipeline engine. Synthetic transport/images and in-memory persistence only. No real photographs, network, browser UI, or live DB acceptance.",
    sourceFiles: paths.map(path => ({ path, sha256: crypto.createHash("sha256").update(fs.readFileSync(path)).digest("hex") })), observations,
  }, null, 2));
});
describe("Image Metadata Extraction through manual and pipeline paths", () => {
  it.each(["zero-gps", "no-exif", "png", "invalid-gps", "http-error", "cors-error", "invalid-bytes", "truncated-png", "empty-jpeg", "oversized", "private-redirect", "private-dns", "redirect-loop"])("preserves %s", async scenario => {
    state.scenario = scenario;
    const accepted = ["zero-gps", "no-exif", "png"].includes(scenario);
    const manual = await executeTool(tool, state.inputs); const run = await executePipeline("fixture-pipeline", "fixture-user");
    expect(manual.status).toBe(accepted ? "success" : scenario === "invalid-gps" ? "partial" : "error"); expect(run.status).toBe(accepted ? "completed" : scenario === "invalid-gps" ? "partial" : "failed");
    expect(run.artifactsCreated).toBe(accepted ? 1 : 0);
    expect(state.writes.find(write => write.table === "tool_results")!.payload.status).toBe(manual.status);
    expect(state.writes.filter(write => write.table === "artifacts")).toHaveLength(accepted ? 1 : 0);
    expect(state.traffic.some(url => url.includes("127.0.0.1"))).toBe(false); expect(state.invoke).not.toHaveBeenCalled();
    if (scenario === "zero-gps") {
      expect(manual.details.geolocation).toEqual({ latitude: 0, longitude: 0 }); expect(manual.tags).toContain("geolocation");
      expect(manual.details.source_url).toBe(state.inputs.image_url); expect(manual.details.notes).toBe("SYNTHETIC IMAGE");
      expect(manual.details.provenance).toMatchObject({ source: "fetched image bytes", parser: "exifr", max_bytes: IMAGE_MAX_BYTES });
    }
    if (scenario === "no-exif") { expect(manual.details.exif).toBeNull(); expect(manual.details.geolocation).toBeNull(); expect(manual.summary).toContain("No readable metadata"); }
    if (scenario === "png") { expect(manual.details.exif).toMatchObject({ ImageWidth: 2, ImageHeight: 2 }); expect(manual.details.geolocation).toBeNull(); expect(manual.summary).not.toContain("EXIF extracted"); }
    if (scenario === "invalid-gps") { expect(manual.details.exif).toMatchObject({ longitude: 181 }); expect(manual.details.geolocation).toBeNull(); expect(manual.details.warnings).toEqual([expect.stringContaining("invalid")]); }
    observations.push({ scenario, manualStatus: manual.status, pipelineStatus: run.status, artifactsCreated: run.artifactsCreated, provenance: manual.details.provenance, reason: manual.details.reason, accepted: true });
  });
  it("keeps a parser exception as error on both paths, never confirmed missing EXIF", async () => {
    // Only this failure-injection test substitutes the parser. All byte fixtures
    // above use the real exifr package, including GPS 0,0 and invalid GPS 0,181.
    state.scenario = "parser-error";
    const manual = await executeTool(tool, state.inputs); const run = await executePipeline("fixture-pipeline", "fixture-user");
    expect(manual.status).toBe("error"); expect(manual.summary).toContain("absence of EXIF was not confirmed");
    expect(run.status).toBe("failed"); expect(run.artifactsCreated).toBe(0);
  });
  it.each(["http://images.example.invalid/image.jpg", "file:///fixture.jpg", "https://fixture:placeholder@images.example.invalid/image.jpg", "https://127.0.0.1/image.jpg", "https://[::1]/image.jpg"])("blocks unsafe image source %s before network", async image_url => {
    const result = await executeTool(tool, { image_url }); expect(result.status).toBe("error"); expect(state.traffic).toHaveLength(0);
  });
  it("passes a bounded deadline and propagates an aborted request", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(AbortSignal.abort(new DOMException("SYNTHETIC timeout", "TimeoutError")));
    vi.stubGlobal("fetch", vi.fn(async (_url: string, options: RequestInit) => { options.signal?.throwIfAborted(); throw new Error("Unreachable"); }));
    try { const manual = await executeTool(tool, state.inputs); expect(manual.status).toBe("error"); expect(manual.summary).toContain("timeout"); expect(timeout).toHaveBeenCalledWith(IMAGE_TIMEOUT_MS); }
    finally { timeout.mockRestore(); }
  });
});
