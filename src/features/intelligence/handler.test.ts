// @vitest-environment node
// Handler execution with isolated Auth/RPC/worker dependencies; no live lookups.
import { describe, expect, it, vi } from "vitest";
import { createIntelligenceHandler } from "../../../supabase/functions/intelligence-tools/handler";

const workerToken = "test-worker-token-only-000000000000000000";
const baseEnv: Record<string, string> = {
  SUPABASE_URL: "https://backend.example", SUPABASE_ANON_KEY: "test-anon",
  INTELLIGENCE_WORKER_URL: "https://worker.example", INTELLIGENCE_WORKER_TOKEN: workerToken,
  MARKETPLACE_HIBP_FREE_ALLOWANCE_VERIFIED: "true", INTELLIGENCE_IPINFO_ALLOWANCE_VERIFIED: "true",
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const request = (body: unknown = { action: "ipinfo", input: { ip: "8.8.8.8" } }, authorization = "Bearer user-session") => new Request("https://backend.example/functions/v1/intelligence-tools", { method: "POST", headers: { authorization, "Content-Type": "application/json" }, body: JSON.stringify(body) });

function setup(options: { env?: Record<string, string>; session?: Response; reservationResponse?: Response; admission?: unknown; worker?: Response | Error; settle?: Response } = {}) {
  const env = { ...baseEnv, ...options.env };
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const target = String(url);
    if (target.endsWith("/auth/v1/user")) return options.session || json({ id: "verified-user" });
    if (target.endsWith("/reserve_intelligence_execution")) return options.reservationResponse || json(options.admission || { allowed: true, id: "reservation-1" });
    if (target.endsWith("/finish_intelligence_execution")) return options.settle || json({ ok: true });
    if (target === "https://worker.example/intelligence") {
      if (options.worker instanceof Error) throw options.worker;
      return options.worker || json({ ok: true, data: { provider: "ipinfo", ip: "8.8.8.8", source: "test fixture" } });
    }
    throw new Error(`Unexpected test fetch: ${target}`);
  });
  return { fetchImpl, handler: createIntelligenceHandler({ getEnv: (name) => env[name], fetchImpl }) };
}

describe("authenticated intelligence Edge adapter", () => {
  it("rejects missing authentication before any network or worker operation", async () => {
    const { handler, fetchImpl } = setup();
    expect((await handler(request(undefined, ""))).status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("passes only explicit input to the worker with a separate server credential and settles usage", async () => {
    const { handler, fetchImpl } = setup();
    const response = await handler(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, data: { provider: "ipinfo", source: "test fixture" } });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    const workerCall = fetchImpl.mock.calls.find(([url]) => String(url).includes("worker.example"))!;
    expect(workerCall[1]?.headers).toMatchObject({ Authorization: `Bearer ${workerToken}` });
    expect(workerCall[1]?.body).toBe(JSON.stringify({ action: "ipinfo", input: { ip: "8.8.8.8" } }));
    expect(workerCall[1]?.redirect).toBe("error");
    expect(fetchImpl.mock.calls[3][1]?.body).toBe(JSON.stringify({ p_execution_id: "reservation-1", p_success: true }));
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("requires worker configuration before reserving quota or running a provider", async () => {
    const { handler, fetchImpl } = setup({ env: { INTELLIGENCE_WORKER_URL: "" } });
    const response = await handler(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "CONFIGURATION_REQUIRED" } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not treat a configured provider key as verified included allowance", async () => {
    for (const [action, input, flag, key] of [
      ["breach", { email: "fixture@example.com" }, "MARKETPLACE_HIBP_FREE_ALLOWANCE_VERIFIED", "HIBP_API_KEY"],
      ["ipinfo", { ip: "8.8.8.8" }, "INTELLIGENCE_IPINFO_ALLOWANCE_VERIFIED", "IPINFO_TOKEN"],
    ] as const) {
      const { handler, fetchImpl } = setup({ env: { [flag]: "", [key]: "configured-test-key" } });
      const response = await handler(request({ action, input }));
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ ok: false, error: { code: "ALLOWANCE_REQUIRED" } });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });

  it("rejects an expired verified session before any permission or worker operation", async () => {
    const { handler, fetchImpl } = setup({ session: json({ message: "Session expired" }, 401) });
    expect((await handler(request())).status).toBe(401);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the required migration has not been applied", async () => {
    const { handler, fetchImpl } = setup({ reservationResponse: json({ code: "PGRST202", message: "RPC not found" }, 404) });
    const response = await handler(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "ACCOUNTING_UNAVAILABLE" } });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("blocks cleartext and loopback worker URLs from a hosted backend", async () => {
    for (const url of ["http://worker.example", "http://127.0.0.1:43410", "https://127.0.0.1:43410", "https://user:password@worker.example", "https://worker.example/?token=private"]) {
      const { handler, fetchImpl } = setup({ env: { INTELLIGENCE_WORKER_URL: url, INTELLIGENCE_ALLOW_LOOPBACK: "true" } });
      expect((await handler(request())).status).toBe(503);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });

  it("respects atomic permission and daily-quota denials without contacting the worker", async () => {
    for (const [code, status] of [["FORBIDDEN", 403], ["DAILY_LIMIT", 429]] as const) {
      const { handler, fetchImpl } = setup({ admission: { allowed: false, code, retryAfter: 120 } });
      const response = await handler(request());
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ ok: false, error: { code } });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    }
  });

  it("preserves provider rate-limit information and releases a failed request's reservation", async () => {
    const { handler, fetchImpl } = setup({ worker: json({ ok: false, error: { code: "RATE_LIMITED", message: "HIBP rate limited this request.", retryAfter: 13 } }, 429) });
    const response = await handler(request({ action: "breach", input: { email: "fixture@example.com" } }));
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "RATE_LIMITED", retryAfter: 13 } });
    expect(fetchImpl.mock.calls[3][1]?.body).toBe(JSON.stringify({ p_execution_id: "reservation-1", p_success: false }));
  });

  it("does not expose raw connection errors, credentials or request data", async () => {
    const { handler } = setup({ worker: new Error(`connection failed bearer ${workerToken} fixture@example.com`) });
    const response = await handler(request());
    const text = await response.text();
    expect(response.status).toBe(502);
    expect(text).not.toContain(workerToken);
    expect(text).not.toContain("fixture@example.com");
    expect(text).toContain("SERVICE_UNAVAILABLE");
  });

  it("rejects unsupported fields and malformed email input before accounting or provider calls", async () => {
    for (const body of [{ action: "profile", input: { username: "example", workerUrl: "https://attacker.example" } }, { action: "breach", input: { email: "invalid" } }, { action: "unknown", input: {} }]) {
      const { handler, fetchImpl } = setup();
      expect((await handler(request(body))).status).toBe(400);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });

  it("rejects malformed worker results and releases quota", async () => {
    const { handler, fetchImpl } = setup({ worker: json({ ok: true, data: "not an object" }) });
    expect((await handler(request())).status).toBe(502);
    expect(fetchImpl.mock.calls[3][1]?.body).toContain('"p_success":false');
  });

  it("does not claim success when usage settlement fails", async () => {
    const { handler } = setup({ settle: json({ message: "database unavailable" }, 503) });
    const response = await handler(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "ACCOUNTING_UNAVAILABLE" } });
  });

  it("handles preflight and rejects unsupported methods without network activity", async () => {
    const { handler, fetchImpl } = setup();
    expect((await handler(new Request("https://example.test", { method: "OPTIONS" }))).status).toBe(200);
    expect((await handler(new Request("https://example.test"))).status).toBe(405);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
