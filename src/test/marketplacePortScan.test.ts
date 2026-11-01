import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

// Execute the real route source with only platform/auth imports substituted.
const source = readFileSync("functions/api/marketplace-port-scan.js", "utf8")
  .replace(/^import .*;\r?\n/gm, "")
  .replace(/^export /gm, "");
function handlers(connect = vi.fn(), user: unknown = { id: "authorized-fixture-user" }) {
  const auth = vi.fn().mockResolvedValue(user);
  const module = new Function("connect", "authenticatedUser", `${source}\nreturn { onRequestGet, onRequestPost };`)(connect, auth);
  return { ...module, connect, auth };
}
const env = { SUPABASE_URL: "https://project.example", SUPABASE_PUBLISHABLE_KEY: "public-fixture-key", PORTSCAN_ALLOWED_IPS: "8.8.8.8" };
const request = (body: unknown) => new Request("https://app.example/api/marketplace-port-scan", { method: "POST", headers: { Authorization: "Bearer fixture-session", "Content-Type": "application/json" }, body: JSON.stringify(body) });
afterEach(() => vi.useRealTimers());

describe("allowlisted Cloudflare TCP connection probes", () => {
  it("requires verified authentication without attempting a socket", async () => {
    const module = handlers(vi.fn(), null);
    const result = await module.onRequestPost({ request: request({ ip: "8.8.8.8", ports: [443], authorization_confirmed: true }), env });
    expect(result.status).toBe(401); expect(module.connect).not.toHaveBeenCalled();
  });
  it("reports missing target configuration and fails closed", async () => {
    const module = handlers(); const empty = { ...env, PORTSCAN_ALLOWED_IPS: "" };
    const status = await module.onRequestGet({ request: new Request("https://app.example/api/marketplace-port-scan"), env: empty });
    expect(await status.json()).toMatchObject({ configured: false, missing_config: ["PORTSCAN_ALLOWED_IPS"] });
    const result = await module.onRequestPost({ request: request({ ip: "8.8.8.8", ports: "443", authorization_confirmed: true }), env: empty });
    expect(result.status).toBe(503); expect(module.connect).not.toHaveBeenCalled();
  });
  it("rejects target drift, private/reserved addresses, and wildcard policy", async () => {
    const module = handlers();
    for (const ip of ["9.9.9.9", "127.0.0.1", "10.0.0.1", "192.168.1.2", "198.51.100.1", "8.8.8.8/32", "08.8.8.8", "example.org"]) {
      const result = await module.onRequestPost({ request: request({ ip, ports: [443], authorization_confirmed: true }), env });
      expect(result.status).toBeGreaterThanOrEqual(400);
    }
    const status = await module.onRequestGet({ request: new Request("https://app.example/api/marketplace-port-scan"), env: { ...env, PORTSCAN_ALLOWED_IPS: "*" } });
    expect(status.status).toBe(503); expect(module.connect).not.toHaveBeenCalled();
  });
  it("requires the per-target authorization confirmation and limits explicit ports", async () => {
    const module = handlers();
    for (const body of [
      { ip: "8.8.8.8", ports: [443] },
      { ip: "8.8.8.8", ports: [25], authorization_confirmed: true },
      { ip: "8.8.8.8", ports: "1-100", authorization_confirmed: true },
      { ip: "8.8.8.8", ports: Array.from({ length: 11 }, (_, i) => i + 100), authorization_confirmed: true },
    ]) {
      const result = await module.onRequestPost({ request: request(body), env });
      expect(result.status).toBeGreaterThanOrEqual(400);
    }
    expect(module.connect).not.toHaveBeenCalled();
  });
  it("reports real connection establishment, sends no payload, and closes each socket", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const write = vi.fn();
    const connect = vi.fn().mockImplementation(() => ({ opened: Promise.resolve({ remoteAddress: "8.8.8.8" }), closed: Promise.resolve(), close, writable: { getWriter: () => ({ write }) } }));
    const module = handlers(connect);
    const result = await module.onRequestPost({ request: request({ ip: "8.8.8.8", ports: "80,443", authorization_confirmed: true }), env });
    expect(await result.json()).toMatchObject({ ip: "8.8.8.8", ports: [{ port: 80, status: "open" }, { port: 443, status: "open" }] });
    expect(connect.mock.calls[0][0]).toEqual({ hostname: "8.8.8.8", port: 80 });
    expect(close).toHaveBeenCalledTimes(2); expect(write).not.toHaveBeenCalled();
  });
  it("distinguishes runtime prohibition from ambiguous connection failure", async () => {
    const connect = vi.fn().mockImplementationOnce(() => { throw new Error("proxy request failed, cannot connect to the specified address"); }).mockImplementationOnce(() => ({ opened: Promise.reject(new Error("connection refused")), closed: Promise.reject(new Error("closed")), close: vi.fn().mockResolvedValue(undefined) }));
    const module = handlers(connect);
    const result = await module.onRequestPost({ request: request({ ip: "8.8.8.8", ports: [80, 443], authorization_confirmed: true }), env });
    expect(await result.json()).toMatchObject({ ports: [{ status: "runtime_blocked" }, { status: "unknown" }] });
  });
  it("times out bounded sockets and never labels a timeout as closed", async () => {
    vi.useFakeTimers(); const close = vi.fn().mockResolvedValue(undefined);
    const module = handlers(vi.fn().mockReturnValue({ opened: new Promise(() => {}), closed: Promise.resolve(), close }));
    const pending = module.onRequestPost({ request: request({ ip: "8.8.8.8", ports: [443], authorization_confirmed: true }), env });
    await vi.advanceTimersByTimeAsync(1600);
    const result = await pending;
    expect(await result.json()).toMatchObject({ ports: [{ status: "timeout" }] });
    expect(close).toHaveBeenCalledTimes(1);
  });
  it("rejects cross-origin browser use before calling the authentication service", async () => {
    const module = handlers();
    const result = await module.onRequestGet({ request: new Request("https://app.example/api/marketplace-port-scan", { headers: { Origin: "https://unrelated.example" } }), env });
    expect(result.status).toBe(403); expect(module.auth).not.toHaveBeenCalled(); expect(module.connect).not.toHaveBeenCalled();
  });
});
