// Actual gateway + safe-fetch source, synthetic identity/DB/transport only.
import fs from "node:fs/promises";
import vm from "node:vm";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import ts from "typescript";
import { z } from "zod";
let handler, mode, queries, writes, calls, clients, permissionReads;
const actor = "00000000-0000-4000-8000-000000000001", ownCase = "00000000-0000-4000-8000-000000000002", foreignCase = "00000000-0000-4000-8000-000000000003";
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
const transport = async input => {
  const url = new URL(input); calls.push(url.toString());
  if (url.hostname === "synthetic.invalid") {
    if (mode === "auth-throws") throw new Error("SYNTHETIC private Auth failure");
    if (mode === "invalid-auth") return json({}, 401);
    if (mode === "auth-oversized") return new Response("x".repeat(70000));
    return json({ id: mode === "auth-malformed" ? "invalid-uuid" : actor, role: "authenticated", is_anonymous: mode === "anonymous" });
  }
  if (url.hostname === "cloudflare-dns.com") return json({ Answer: [{ type: 1, data: mode === "private-dns" ? "127.0.0.1" : "93.184.215.14" }] });
  if (url.hostname === "rdap.org") return json({ handle: "SYNTHETIC-RDAP" });
  if (url.hostname === "api.ssllabs.com") return mode === "ssl-malformed" ? json([]) : mode === "ssl-failed" ? json({ status: "ERROR" }) : json({ status: mode === "ssl-ready" ? "READY" : "IN_PROGRESS", endpoints: mode === "ssl-ready" ? [{ grade: "A" }] : [] });
  if (url.hostname === "example.invalid") {
    if (mode === "private-redirect") return new Response(null, { status: 302, headers: { location: "https://127.0.0.1/private" } });
    return new Response(null, { status: mode === "probe-denied" ? 403 : 200 });
  }
  throw new Error("Unlisted synthetic transport destination");
};
const context = { Error, Date, URL, URLSearchParams, Request, Response, Headers, AbortSignal, AbortController, Uint8Array, TextDecoder, TextEncoder, setTimeout, clearTimeout, fetch: transport };
const compile = (source, module = ts.ModuleKind.CommonJS) => ts.transpileModule(source, { compilerOptions: { module, target: ts.ScriptTarget.ES2022 } }).outputText;
const guardSource = await fs.readFile("supabase/functions/_shared/safeFetch.ts", "utf8");
const exports = {};
new vm.Script(compile(guardSource)).runInNewContext({ ...context, exports });
function createClient(_url, key) {
  clients.push(key);
  return { auth: { getUser: async () => {
    if (mode === "auth-throws") throw new Error("Synthetic auth outage");
    return { data: { user: mode === "invalid-auth" ? null : { id: actor } }, error: null };
  } }, from(table) {
    const filters = {};
    const result = () => {
      queries.push({ table, filters });
      if (table === "tool_permissions") {
        permissionReads++;
        return { data: mode === "permission-malformed" ? {} : mode === "permission-value" ? [{ allowed: "false" }] : mode === "disabled" || (mode === "alias-disabled" && filters.tool_id.includes("subdomain_enum")) || (mode === "revoked" && permissionReads > 1) ? [{ allowed: false }] : [], error: mode === "permission-error" ? { message: "Synthetic policy error" } : null };
      }
      if (table === "cases") return { data: filters.id === ownCase && mode !== "case-missing" && mode !== "case-error" ? { id: ownCase, owner_id: mode === "wrong-owner" ? foreignCase : actor } : null, error: mode === "case-error" ? { message: "Synthetic denied case lookup" } : null };
      throw new Error("Unexpected repository query");
    };
    const q = { select: () => q, eq: (key, value) => { filters[key] = value; return q; }, in: (key, value) => { filters[key] = value; return q; }, maybeSingle: async () => result(), then: resolve => Promise.resolve(result()).then(resolve), insert: async payload => {
      if (mode === "insert-throws") throw new Error("Synthetic insert outage");
      if (mode === "insert-error") return { error: { message: "Synthetic insert failure" } };
      writes.push({ table, payload, key }); return { error: null };
    } }; return q;
  } };
}
const source = await fs.readFile("supabase/functions/osint-dispatch/index.ts", "utf8");
const runtime = { env: { get: name => ({ SUPABASE_URL: "https://synthetic.invalid", SUPABASE_ANON_KEY: "synthetic-user", SUPABASE_SERVICE_ROLE_KEY: "synthetic-admin-must-never-be-read" })[name] } };
const auth = {};
new vm.Script(compile(await fs.readFile("supabase/functions/_shared/authenticateUser.ts", "utf8"))).runInNewContext({ ...context, exports: auth, Deno: runtime });
new vm.Script(compile(source.replace(/^import .*;\r?\n/gm, ""), ts.ModuleKind.ESNext)).runInNewContext({ ...context, ...auth, z, safeFetch: exports.safeFetch, createClient, serve: fn => { handler = fn; }, Deno: runtime });
const checks = [];
async function run(name, selectedMode, body, expectedStatus, expectedHttp, noProvider = false) {
  mode = selectedMode; queries = []; writes = []; calls = []; clients = []; permissionReads = 0;
  let failure;
  try {
    const response = await handler(new Request("https://synthetic-handler.invalid", { method: "POST", headers: name === "missing auth" ? {} : { Authorization: "Bearer synthetic" }, body: JSON.stringify(body) }));
    const data = await response.json();
    assert.equal(data.status ?? (response.status === 401 ? "error" : undefined), expectedStatus); assert.equal(response.status, expectedHttp);
    assert.ok(clients.every(key => key === "synthetic-user"));
    if (noProvider) { assert.equal(calls.filter(url => new URL(url).hostname !== "synthetic.invalid").length, 0); assert.equal(writes.length, 0); }
    if (selectedMode === "insert-error") { assert.equal(data.saved, false); assert.equal(data.computation.status, "success"); assert.equal(writes.length, 0); }
    if (["disabled", "permission-error", "permission-malformed", "permission-value"].includes(selectedMode)) assert.equal(JSON.stringify(queries[0].filters.tool_id), JSON.stringify(["domain_whois", "whois-history"]));
    if (selectedMode === "revoked") { assert.equal(writes.length, 0); assert.equal(permissionReads, 2); }
    if (expectedStatus === "success") { assert.equal(data.saved, true); assert.equal(writes.length, 1); assert.equal(writes[0].payload.user_id, actor); }
    if (expectedStatus === "partial") { assert.equal(writes[0].payload.status, "partial"); assert.equal(data.result.status, "IN_PROGRESS"); }
    if (selectedMode.startsWith("private")) assert.ok(calls.every(url => !new URL(url).hostname.startsWith("127.")));
    if (body.tool === "ip_geolocation") assert.equal(calls.filter(url => new URL(url).hostname !== "synthetic.invalid").length, 0);
    if (body.tool === "subdomain_finder") assert.equal(JSON.stringify(queries[0].filters.tool_id), JSON.stringify(["subdomain_finder", "subdomain-enum", "subdomain_enum"]));
    checks.push({ name, passed: true, http: response.status, status: data.status, syntheticProviderCalls: calls.filter(url => !["cloudflare-dns.com", "synthetic.invalid"].includes(new URL(url).hostname)).length, savedRows: writes.length });
  } catch (error) { failure = error.message; checks.push({ name, passed: false, reason: failure }); }
}
const domain = { tool: "domain_whois", params: { domain: "example.invalid" } };
for (const value of ["disabled", "permission-error", "permission-malformed", "permission-value"]) await run(value, value, domain, "error", 403, true);
await run("foreign case", "normal", { ...domain, case_id: foreignCase }, "error", 403, true);
await run("denied alternate alias cannot bypass canonical permission", "alias-disabled", { tool: "subdomain_finder", params: { domain: "example.invalid" } }, "error", 403, true);
for (const value of ["case-missing", "case-error", "wrong-owner"]) await run(value, value, { ...domain, case_id: ownCase }, "error", 403, true);
await run("owned case", "normal", { ...domain, case_id: ownCase }, "success", 200);
await run("standalone", "normal", domain, "success", 200);
await run("revoked before save", "revoked", domain, "error", 403);
await run("insert error", "insert-error", domain, "error", 500);
await run("insert exception", "insert-throws", domain, "error", 503);
await run("missing auth", "normal", domain, "error", 401, true);
await run("invalid auth", "invalid-auth", domain, "error", 401, true);
await run("auth exception", "auth-throws", domain, "error", 503, true);
await run("anonymous Auth", "anonymous", domain, "error", 403, true);
await run("malformed Auth", "auth-malformed", domain, "error", 502, true);
await run("oversized Auth", "auth-oversized", domain, "error", 503, true);
await run("bounded dispatcher body", "normal", { ...domain, params: { domain: "x".repeat(17000) } }, "error", 413, true);
await run("unsupported ID", "normal", { tool: "social_analyzer", params: {} }, "unknown_tool", 422, true);
await run("SSL progress", "ssl-progress", { tool: "ssl_inspection", params: { host: "example.invalid" } }, "partial", 200);
await run("SSL final", "ssl-ready", { tool: "ssl_inspection", params: { host: "example.invalid" } }, "success", 200);
await run("SSL failed", "ssl-failed", { tool: "ssl_inspection", params: { host: "example.invalid" } }, "error", 200);
await run("SSL malformed", "ssl-malformed", { tool: "ssl_inspection", params: { host: "example.invalid" } }, "error", 200);
for (const url of ["https://127.0.0.1/private", "http://127.0.0.1/private", "https://[::1]/private"]) await run("private URL " + url, "private-ip", { tool: "http_port_probe", params: { url } }, "error", 200);
await run("private DNS", "private-dns", { tool: "http_port_probe", params: { url: "https://example.invalid" } }, "error", 200);
await run("private redirect", "private-redirect", { tool: "http_port_probe", params: { url: "https://example.invalid" } }, "error", 200);
await run("HTTP rejection", "probe-denied", { tool: "http_port_probe", params: { url: "https://example.invalid" } }, "error", 200);
await run("IP provider unavailable", "normal", { tool: "ip_geolocation", params: { ip: "8.8.8.8" } }, "not_configured", 200);
const evidence = { scope: "Actual isolated dispatcher and fetch guard. Synthetic auth, policy responses, repository and network transport only; no sockets, SQL/RLS, production deployment or live acceptance. Owner checkout not accessed.", sourceSha256: crypto.createHash("sha256").update(source).digest("hex"), passed: checks.filter(c => c.passed).length, total: checks.length, checks };
await fs.mkdir("evidence/retained-dispatch", { recursive: true });
await fs.writeFile("evidence/retained-dispatch/dispatch-verification.json", JSON.stringify(evidence, null, 2));
console.log(JSON.stringify({ passed: evidence.passed, total: evidence.total, failures: checks.filter(c => !c.passed) }, null, 2));
if (evidence.passed !== evidence.total) process.exitCode = 1;
