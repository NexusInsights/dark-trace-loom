// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { parsePhoneNumberFromString } from "libphonenumber-js/min";
let handler: (req: Request) => Promise<Response>;
let auth: ReturnType<typeof vi.fn>, provider: ReturnType<typeof vi.fn>;
beforeEach(() => {
  auth = vi.fn(async () => new Response(JSON.stringify({id:"11111111-1111-4111-8111-111111111111"}))); provider = vi.fn();
  const source = fs.readFileSync("supabase/functions/_shared/authenticateUser.ts", "utf8").replace(/^export /gm, "") + "\n" + fs.readFileSync("supabase/functions/osint-tools/index.ts", "utf8").replace(/^import .*;\r?\n/gm, "");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  new vm.Script(code).runInContext(vm.createContext({
    Deno: { env: { get: (name: string) => name === "SUPABASE_URL" ? "https://fixture-auth.invalid" : name === "SUPABASE_ANON_KEY" ? "synthetic-public-key" : undefined }, serve: (fn: typeof handler) => { handler = fn; } },
    parsePhoneNumberFromString: (phone: string, options: { extract?: boolean }) => parsePhoneNumberFromString(phone, { ...options }), boundedFetch: provider, fetch: (url: string, init: RequestInit) => { if (url.startsWith("https://fixture-auth.invalid/auth/")) { return auth(); } if (url.startsWith("https://fixture-auth.invalid/rest/")) return new Response("[]"); return provider(url, init); }, TextDecoder, TextEncoder, Uint8Array, AbortController, Request, Response, Headers, URL, URLSearchParams, FormData, AbortSignal, Error, setTimeout, clearTimeout,
  }));
});
const request = (action: string, params = {}) => new Request("https://local-handler.invalid", { method: "POST", headers: {Authorization:"Bearer synthetic-session"}, body: JSON.stringify({ action, params }) });
it("rejects unauthorized requests before reaching any provider", async () => {
  auth.mockResolvedValue(new Response("{}", {status:401})); expect((await handler(request("pdl-person-search"))).status).toBe(401); expect(provider).not.toHaveBeenCalled();
});
it("rejects unsupported HTTP methods before authentication", async () => {
  expect((await handler(new Request("https://local-handler.invalid"))).status).toBe(405); expect(auth).not.toHaveBeenCalled();
});
it("returns explicit unknown_tool rather than a success envelope", async () => {
  const response = await handler(request("social_analyzer")); expect(response.status).toBe(400); expect((await response.json()).status).toBe("unknown_tool");
});
it("preserves a missing provider as not_configured without a paid request", async () => {
  const response = await handler(request("pdl-person-enrich", { email: "example@example.com" }));
  expect(response.status).toBe(500); expect((await response.json()).status).toBe("not_configured"); expect(provider).not.toHaveBeenCalled();
});
it("does not turn a rejected breach-provider response into no breaches", async () => {
  provider.mockResolvedValue(new Response(JSON.stringify({ success: false })));
  const response = await handler(request("breach-lookup", { query: "example@example.com" }));
  expect(response.status).toBe(500); expect((await response.json()).status).toBe("error");
});
it("preserves failed username probes as unknown, not confirmed absence", async () => {
  provider.mockRejectedValue(new Error("Fixture provider unavailable"));
  const body = await (await handler(request("username-search", { username: "fixture" }))).json();
  expect(body.status).toBe("partial"); expect(body.results.every((row: { found: unknown }) => row.found === null)).toBe(true);
});
