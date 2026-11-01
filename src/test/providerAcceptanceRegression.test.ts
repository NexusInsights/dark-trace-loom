// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { parsePhoneNumberFromString } from "libphonenumber-js/min";
let handler: (request: Request) => Promise<Response>;
let transport: ReturnType<typeof vi.fn>;
beforeEach(() => {
  transport = vi.fn();
  const source = fs.readFileSync("supabase/functions/_shared/authenticateUser.ts", "utf8").replace(/^export /gm, "") + "\n" + fs.readFileSync("supabase/functions/osint-tools/index.ts", "utf8").replace(/^import .*;\r?\n/gm, "");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  new vm.Script(code).runInContext(vm.createContext({
    Deno: { env: { get: (name: string) => name === "SUPABASE_URL" ? "https://fixture-auth.invalid" : name === "SUPABASE_ANON_KEY" ? "synthetic-public-key" : undefined }, serve: (fn: typeof handler) => { handler = fn; } },
    // Keep SDK options in its native realm; phone parsing still uses the real metadata.
    parsePhoneNumberFromString: (phone: string, options: { extract?: boolean }) => parsePhoneNumberFromString(phone, { ...options }), boundedFetch: transport, fetch: (url: string, init: RequestInit) => { if (url.startsWith("https://fixture-auth.invalid/auth/")) { return new Response(JSON.stringify({id:"11111111-1111-4111-8111-111111111111"})); } if (url.startsWith("https://fixture-auth.invalid/rest/")) return new Response("[]"); return transport(url, init); },
    TextDecoder, TextEncoder, Uint8Array, AbortController, Request, Response, Headers, URL, URLSearchParams, FormData, AbortSignal, Error, Date, setTimeout, clearTimeout,
  }));
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
async function call(action: string, params: Record<string, unknown>) {
  const response = await handler(new Request("https://fixture.invalid", { method: "POST", headers: {Authorization:"Bearer synthetic-session"}, body: JSON.stringify({ action, params }) }));
  return { httpStatus: response.status, body: await response.json() };
}
describe("local phone metadata", () => {
  it.each([
    ["+12025550142", "+1", "US"],
    // Reserved fictional UK mobile range is possible but not region-verified metadata.
    ["+447700900123", "+44", null],
    ["+80012345678", "+800", null],
  ])("parses synthetic %s without making a provider request", async (phone, code, country) => {
    const result = await call("phone-lookup", { phone });
    expect(result.httpStatus).toBe(200); expect(result.body.country_code).toBe(code); expect(result.body.country_iso).toBe(country);
    expect(result.body.timezones).toBeNull(); expect(result.body.note).toContain("No live carrier"); expect(transport).not.toHaveBeenCalled();
  });
  it.each(["", "2025550142", "+1", "+99912345", "text +12025550142 text"])("rejects incomplete/ambiguous input %s", async phone => {
    expect((await call("phone-lookup", { phone })).body.status).toBe("error"); expect(transport).not.toHaveBeenCalled();
  });
});
describe("reverse geocoding", () => {
  it.each([{ error: "Unable to geocode" }, {}, { display_name: "" }])("rejects a missing resolved location: %j", async data => {
    transport.mockImplementation(async () => json(data));
    const result = await call("reverse-geo", { lat: "0", lng: "0" });
    expect(result.httpStatus).toBe(500); expect(result.body.status).toBe("error"); expect(result.body.reason).toContain("no resolved location");
  });
  it("preserves a positive synthetic result", async () => {
    transport.mockImplementation(async () => json({ display_name: "SYNTHETIC LANDMARK", address: { country: "Fixture" } }));
    expect((await call("reverse-geo", { lat: "0", lng: "0" })).body.display_name).toBe("SYNTHETIC LANDMARK");
  });
});
describe("optional provider subrequests", () => {
  const stats = { address: "SYNTHETIC-WALLET", chain_stats: { funded_txo_sum: 100000000, spent_txo_sum: 25000000, tx_count: 1 } };
  it.each(["http", "network", "invalid-json", "wrong-shape"])("keeps unavailable BTC transactions null and status partial: %s", async failure => {
    transport.mockImplementation(async (url: string) => {
      if (!url.includes("/txs")) return json(stats);
      if (failure === "network") throw new Error("fixture");
      if (failure === "invalid-json") return new Response("invalid");
      return failure === "http" ? json({}, 429) : json({});
    });
    const { body } = await call("btc-wallet", { address: "SYNTHETIC-WALLET" });
    expect(body.status).toBe("partial"); expect(body.balance_btc).toBe("0.75000000"); expect(body.recent_txs).toBeNull();
    expect(body.source_errors).toHaveLength(1); expect(body.source_errors[0].source).toBe("Blockstream transactions");
  });
  it("distinguishes verified empty transactions from unavailable data", async () => {
    transport.mockImplementation(async (url: string) => json(url.includes("/txs") ? [] : stats));
    const { body } = await call("btc-wallet", { address: "SYNTHETIC-WALLET" });
    expect(body.status).toBe("success"); expect(body.recent_txs).toEqual([]); expect(body.source_errors).toEqual([]);
  });
  it.each(["repositories", "events"])("retains the profile and marks failed GitHub %s partial", async failed => {
    transport.mockImplementation(async (url: string) => {
      if (url.includes("/repos?")) return failed === "repositories" ? json({}, 429) : json([]);
      if (url.includes("/events/public")) return failed === "events" ? json({}, 503) : json([]);
      return json({ login: "fixture-organization", public_repos: 2, followers: 0 });
    });
    const { body } = await call("github-recon", { user: "fixture-organization" });
    expect(body.status).toBe("partial"); expect(body.username).toBe("fixture-organization"); expect(body.public_repos).toBe(2);
    expect(failed === "repositories" ? body.recent_repos : body.commit_emails).toBeNull(); expect(body.source_errors).toHaveLength(1);
  });
  it("accepts verified empty GitHub lists as a real negative result", async () => {
    transport.mockImplementation(async (url: string) => json(url.includes("/repos?") || url.includes("/events/public") ? [] : { login: "fixture-organization", public_repos: 0 }));
    const { body } = await call("github-recon", { user: "fixture-organization" });
    expect(body.status).toBe("success"); expect(body.recent_repos).toEqual([]); expect(body.commit_emails).toEqual([]);
  });
});
describe.each(["paste-search", "darkweb-search"])("search page truthfulness: %s", action => {
  it.each([401, 403, 429, 503])("does not convert HTTP %s into zero results", async status => {
    transport.mockImplementation(async () => new Response("<html>access denied</html>", { status }));
    expect((await call(action, { keyword: "fixture-company.invalid" })).body.status).toBe("error");
  });
  it("rejects a challenge even with HTTP 200", async () => {
    transport.mockImplementation(async () => new Response('<form id="challenge-form">verify you are human</form>'));
    expect((await call(action, { keyword: "fixture-company.invalid" })).body.status).toBe("error");
  });
  it("rejects unknown markup instead of claiming zero results", async () => {
    transport.mockImplementation(async () => new Response("<html>new provider layout</html>"));
    expect((await call(action, { keyword: "fixture-company.invalid" })).body.status).toBe("error");
  });
  it("retains an explicitly confirmed zero-result page", async () => {
    transport.mockImplementation(async () => new Response('<div class="no-results">No results found</div>'));
    const result = await call(action, { keyword: "fixture-company.invalid" });
    expect(result.httpStatus).toBe(200); expect(result.body.total).toBe(0);
  });
  it("parses actual positive fixture markup", async () => {
    const html = action === "paste-search" ? '<a class="result__a" href="https://fixture.invalid/document">Synthetic</a>' : '<li class="result"><a href="https://fixture.invalid/">Synthetic</a><p>Fixture snippet</p></li>';
    transport.mockImplementation(async () => new Response(html));
    const result = await call(action, { keyword: "fixture-company.invalid" });
    expect(result.httpStatus).toBe(200); expect(result.body.total).toBe(1);
  });
});
describe("redirect chain accounting", () => {
  it.each([0, 1, 2, 9])("reports %s redirects and one final HTTP response", async redirects => {
    transport.mockImplementation(async (url: string) => {
      const index = Number(new URL(url).pathname.slice(1));
      return index < redirects ? new Response(null, { status: 302, headers: { Location: "/" + (index + 1) } }) : new Response(null, { status: 200 });
    });
    const { body } = await call("url-unshorten", { url: "https://fixture.invalid/0" });
    expect(body.hops).toBe(redirects); expect(body.requests).toBe(redirects + 1); expect(body.chain).toHaveLength(redirects + 1);
    expect(body.final).toBe("https://fixture.invalid/" + redirects); expect(body.status).toBe("success");
  });
  it("fails bounded loops instead of returning an unfetched destination", async () => {
    transport.mockImplementation(async () => new Response(null, { status: 302, headers: { Location: "/loop" } }));
    expect((await call("url-unshorten", { url: "https://fixture.invalid/loop" })).body.status).toBe("error");
    expect(transport).toHaveBeenCalledTimes(10);
  });
  it("rejects redirects without a location", async () => {
    transport.mockImplementation(async () => new Response(null, { status: 302 }));
    expect((await call("url-unshorten", { url: "https://fixture.invalid/" })).body.status).toBe("error");
  });
  it("preserves a non-success final response as partial", async () => {
    transport.mockImplementation(async () => new Response(null, { status: 404 }));
    const { body } = await call("url-unshorten", { url: "https://fixture.invalid/" });
    expect(body.status).toBe("partial"); expect(body.hops).toBe(0); expect(body.final_status).toBe(404);
  });
});
