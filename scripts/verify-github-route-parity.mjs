// Actual two edge handlers and fetch guard; synthetic SDK/auth/transport only.
// No owner checkout access, credentials, native network or live acceptance.
import fs from "node:fs/promises";
import vm from "node:vm";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import ts from "typescript";
import { z } from "zod";
const before = process.argv.includes("--before");
const folder = "evidence/github-route-parity-20261031";
await fs.mkdir(folder, { recursive: true });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
let mode, calls, saved;
const actor = "00000000-0000-4000-8000-000000000001";
const transport = async input => {
  const url = new URL(input); calls.push(url.toString());
  if (url.hostname === "synthetic-auth.invalid") return json(url.pathname.startsWith("/rest/") ? [] : { id: actor, role: "authenticated", is_anonymous: false });
  if (url.hostname === "cloudflare-dns.com") return json({ Answer: [{ type: 1, data: "140.82.112.6" }] });
  assert.equal(url.hostname, "api.github.com", "Only synthetic GitHub fixture destinations allowed");
  if (url.pathname.endsWith("/events/public")) return json([]);
  if (url.pathname.endsWith("/repos")) {
    if (mode === "repos-429") return json({ message: "SYNTHETIC rate limit" }, 429);
    if (mode === "repos-503") return json({}, 503);
    if (mode === "repos-network") throw new Error("SYNTHETIC network failure");
    if (mode === "repos-object") return json({ message: "SYNTHETIC invalid list" });
    if (mode === "repos-json") return new Response("SYNTHETIC invalid JSON");
    return json(mode === "repos-positive" ? [{ name: "synthetic-repository", description: null, language: "TypeScript", stargazers_count: 0, html_url: "https://example.invalid/repo", updated_at: "2026-01-01T00:00:00Z" }] : []);
  }
  if (mode === "profile-404") return json({ message: "SYNTHETIC not found" }, 404);
  if (mode === "profile-malformed") return json({});
  return json({ login: "synthetic-handle", public_repos: 1, followers: 0 });
};
const globals = { Request, Response, Headers, URL, URLSearchParams, AbortController, AbortSignal, TextDecoder, TextEncoder, Uint8Array, Error, setTimeout, clearTimeout, fetch: transport };
const compile = (source, module = ts.ModuleKind.ESNext) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module } }).outputText;
const paths = ["supabase/functions/_shared/safeFetch.ts", "supabase/functions/osint-tools/index.ts", "supabase/functions/osint-dispatch/index.ts"];
const files = await Promise.all(paths.map(p => fs.readFile(p, "utf8")));
const strictAuthSource = (await fs.readFile("supabase/functions/_shared/authenticateUser.ts", "utf8")).replace(/^export /gm, "");
const exports = {};
new vm.Script(compile(files[0], ts.ModuleKind.CommonJS)).runInNewContext({ ...globals, exports });
let manual, dispatch;
new vm.Script(compile(strictAuthSource + "\n" + files[1].replace(/^import .*;\r?\n/gm, ""))).runInNewContext({ ...globals, boundedFetch: exports.safeFetch, parsePhoneNumberFromString: () => { throw new Error("Unrelated fixture route prohibited"); }, Deno: { env: { get: name => ({ SUPABASE_URL: "https://synthetic-auth.invalid", SUPABASE_ANON_KEY: "synthetic-user" })[name] }, serve: fn => { manual = fn; } } });
const sdk = (_url, key) => {
  assert.equal(key, "synthetic-user", "No elevated fixture writer may be constructed");
  return { auth: { getUser: async () => ({ data: { user: { id: actor } }, error: null }) }, from(table) {
    const q = { select: () => q, eq: () => q, in: () => q, then: resolve => {
      assert.equal(table, "tool_permissions"); return Promise.resolve({ data: [], error: null }).then(resolve);
    }, insert: async payload => { assert.equal(table, "tool_results"); saved.push(payload); return { error: null }; } }; return q;
  } };
};
new vm.Script(compile(strictAuthSource + "\n" + files[2].replace(/^import .*;\r?\n/gm, ""))).runInNewContext({ ...globals, z, safeFetch: exports.safeFetch, createClient: sdk, serve: fn => { dispatch = fn; }, Deno: { env: { get: name => ({ SUPABASE_URL: "https://synthetic-auth.invalid", SUPABASE_ANON_KEY: "synthetic-user" })[name] } } });
const cases = ["repos-429", "repos-503", "repos-network", "repos-object", "repos-json", "repos-empty", "repos-positive", "profile-404", "profile-malformed", "user-input-alias"];
const checks = [];
for (const scenario of cases) {
  mode = scenario; calls = []; saved = [];
  const observations = {};
  let failure;
  try {
    for (const [route, handler, body] of [
      ["manual", manual, { action: "github-recon", params: { user: "synthetic-handle" } }],
      ["dispatch", dispatch, { tool: "github_recon", params: scenario === "user-input-alias" ? { user: "synthetic-handle" } : { username: "synthetic-handle" } }],
    ]) {
      const response = await handler(new Request("https://synthetic-handler.invalid", { method: "POST", headers: { Authorization: "Bearer synthetic-not-a-session" }, body: JSON.stringify(body) }));
      const data = await response.json();
      const status = data.status ?? (data.error ? "error" : "success");
      const result = route === "dispatch" ? data.result : data;
      observations[route] = { status, http: response.status, profile: route === "manual" ? result?.username : result?.user?.login, repos: route === "manual" ? result?.recent_repos : result?.repos, sourceErrors: result?.source_errors, reason: data.reason ?? data.error };
    }
    const expected = scenario.startsWith("profile-") ? "error" : ["repos-empty", "repos-positive", "user-input-alias"].includes(scenario) ? "success" : "partial";
    for (const route of ["manual", "dispatch"]) {
      assert.equal(observations[route].status, expected, route + " outcome mismatch");
      if (expected !== "error") assert.equal(observations[route].profile, "synthetic-handle", route + " must preserve verified profile fixture");
      if (expected === "partial") {
        assert.equal(observations[route].repos, null, route + " unavailable repositories must be null");
        assert.equal(observations[route].sourceErrors.length, 1, route + " must retain source failure");
        if (scenario === "repos-429" || scenario === "repos-503") assert.match(observations[route].sourceErrors[0].reason, new RegExp(scenario.slice(-3)), route + " must retain HTTP failure reason");
      }
      if (scenario === "repos-empty") assert.equal(observations[route].repos.length, 0);
      if (scenario === "repos-positive") assert.equal(observations[route].repos[0].name, "synthetic-repository");
    }
    assert.equal(saved.length, 1); assert.equal(saved[0].status, expected);
    if (expected === "partial") assert.equal(saved[0].result_data.result.repos, null);
    if (scenario.startsWith("profile-")) assert.ok(calls.every(url => !/\/(repos|events\/public)(\?|$)/.test(url)), "Invalid profile must stop extra requests");
  } catch (error) { failure = error.message; }
  checks.push({ scenario, passed: !failure, ...(failure ? { reason: failure } : {}), observations, savedStatuses: saved.map(x => x.status), syntheticProviderCalls: calls.filter(url => new URL(url).hostname === "api.github.com").length });
}
const evidence = { scope: "Actual manual osint-tools and osint-dispatch handlers plus safeFetch in Node VM. Auth/SDK/transport are synthetic; no sockets, SQL/RLS, credentials, person queries, owner access or live acceptance.", sourceFiles: paths.map((path, i) => ({ path, sha256: crypto.createHash("sha256").update(files[i]).digest("hex") })), passed: checks.filter(c => c.passed).length, total: checks.length, checks };
await fs.writeFile(folder + (before ? "/before.json" : "/after.json"), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify({ passed: evidence.passed, total: evidence.total, failures: checks.filter(c => !c.passed).map(c => ({ scenario: c.scenario, reason: c.reason })) }, null, 2));
if (evidence.passed !== evidence.total) process.exitCode = 1;
