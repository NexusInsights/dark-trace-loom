// @vitest-environment node
// Operator endpoint tested with isolated environment/network fixtures only.
import { describe, expect, it, vi } from "vitest";
import { createProviderStatusHandler } from "../../../supabase/functions/intelligence-provider-status/handler";

const serviceKey = "fixture-service-role-secret-000000000000000000";
const hibpKey = "fixture-hibp-provider-key-1111111111111111111";
const workerToken = "fixture-private-worker-token-222222222222222";
const baseEnv: Record<string, string> = {
  SUPABASE_SERVICE_ROLE_KEY: serviceKey, HIBP_API_KEY: hibpKey,
  IPINFO_TOKEN: "fixture-ipinfo-secret", X_API_BEARER_TOKEN: "fixture-x-secret",
  INTELLIGENCE_WORKER_URL: "https://fixture-worker.example", INTELLIGENCE_WORKER_TOKEN: workerToken,
};
const subscription = { SubscriptionName: "Pwned 1", SubscribedUntil: "2027-05-01T00:00:00Z", Rpm: 10 };
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const request = (body: unknown = {}, authorization = `Bearer ${serviceKey}`) => new Request("https://backend.example/functions/v1/intelligence-provider-status", {
  method: "POST", headers: { authorization, "Content-Type": "application/json" }, body: JSON.stringify(body),
});

function setup(options: { env?: Record<string, string>; provider?: Response | Error } = {}) {
  const env = { ...baseEnv, ...options.env };
  const getEnv = vi.fn((name: string) => env[name]);
  const fetchImpl = vi.fn(async (): Promise<Response> => {
    if (options.provider instanceof Error) throw options.provider;
    return options.provider || json(subscription);
  });
  return { env, getEnv, fetchImpl, handler: createProviderStatusHandler({ getEnv, fetchImpl }) };
}

describe("service-only provider status endpoint", () => {
  it("denies missing, user, forged-role, malformed and nonmatching credentials before reading metadata or body", async () => {
    for (const authorization of ["", "Bearer user-session", "Bearer eyJyb2xlIjoic2VydmljZV9yb2xlIn0", `apikey ${serviceKey}`, `Bearer ${serviceKey}x`, `Bearer ${serviceKey} extra`]) {
      const { handler, fetchImpl, getEnv } = setup();
      const input = request({ checkHibpSubscription: true }, authorization);
      const response = await handler(input);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ ok: false, error: { code: "UNAUTHORIZED", message: "A trusted service credential is required." } });
      expect(input.bodyUsed).toBe(false);
      expect(getEnv.mock.calls.map(([name]) => name)).toEqual(["SUPABASE_SERVICE_ROLE_KEY"]);
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("fails closed when the server service key is absent, blank, malformed or unreadable", async () => {
    for (const value of ["", " ", `${serviceKey} `]) {
      const { handler, fetchImpl } = setup({ env: { SUPABASE_SERVICE_ROLE_KEY: value } });
      expect((await handler(request())).status).toBe(401);
      expect(fetchImpl).not.toHaveBeenCalled();
    }
    const fetchImpl = vi.fn();
    for (const getEnv of [() => undefined, () => { throw new Error(serviceKey); }]) {
      const response = await createProviderStatusHandler({ getEnv, fetchImpl })(request());
      expect(response.status).toBe(401);
      expect(await response.text()).not.toContain(serviceKey);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("accepts only exact service credentials and returns safe configuration without a network call", async () => {
    const { handler, fetchImpl, env } = setup();
    const response = await handler(request());
    expect(response.status).toBe(200);
    const text = await response.text();
    for (const name of ["SUPABASE_SERVICE_ROLE_KEY", "HIBP_API_KEY", "IPINFO_TOKEN", "X_API_BEARER_TOKEN", "INTELLIGENCE_WORKER_TOKEN", "INTELLIGENCE_WORKER_URL"]) expect(text).not.toContain(env[name]);
    expect(JSON.parse(text)).toMatchObject({ ok: true, data: {
      configuration: { metadataOnly: true, liveChecksPerformed: false,
        ipinfo: { mode: "legacy", tokenConfigured: true, includedAccessVerified: false },
        hibp: { keyConfigured: true, includedAccessVerified: false },
        x: { mode: "browser", bearerConfigured: true, includedAccessVerified: false },
        runtime: { httpProviders: "supabase_edge", browserProviders: "external_browser_worker", browserWorker: { urlConfigured: true, tokenConfigured: true } },
      }, accountChecks: { hibpSubscription: { requested: false, performed: false } },
    } });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.has("Access-Control-Allow-Origin")).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("normalizes invalid modes and literal verified flags without echoing environment strings", async () => {
    const { handler, fetchImpl } = setup({ env: {
      IPINFO_API_MODE: "private-unrecognized-mode", X_API_MODE: "private-other-mode",
      INTELLIGENCE_IPINFO_ALLOWANCE_VERIFIED: "TRUE", MARKETPLACE_HIBP_FREE_ALLOWANCE_VERIFIED: "true", X_INCLUDED_ACCESS_VERIFIED: "true",
      INTELLIGENCE_WORKER_URL: "", INTELLIGENCE_WORKER_TOKEN: "",
    } });
    const data = await (await handler(request({ checkHibpSubscription: false }))).json();
    expect(data.data.configuration.ipinfo).toMatchObject({ mode: null, modeValid: false, includedAccessVerified: false });
    expect(data.data.configuration.x).toMatchObject({ mode: null, modeValid: false, includedAccessVerified: true });
    expect(data.data.configuration.hibp.includedAccessVerified).toBe(true);
    expect(data.data.configuration.runtime.browserWorker).toEqual({ urlConfigured: false, tokenConfigured: false });
    expect(JSON.stringify(data)).not.toContain("private-");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("requires authenticated POST and never adds a public preflight route", async () => {
    const { handler, fetchImpl } = setup();
    for (const method of ["GET", "OPTIONS", "PUT"]) {
      expect((await handler(new Request("https://backend.example", { method }))).status).toBe(401);
      expect((await handler(new Request("https://backend.example", { method, headers: { authorization: `Bearer ${serviceKey}` } }))).status).toBe(405);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects unknown fields, nonboolean flags, arrays and malformed JSON without provider work", async () => {
    const { handler, fetchImpl } = setup();
    for (const body of [{ email: "fixture@example.com" }, { checkHibpSubscription: "true" }, { checkHibpSubscription: null }, [], null, 1]) {
      expect((await handler(request(body))).status).toBe(400);
    }
    for (const body of ["{", "", '{"__proto__":{}}']) {
      expect((await handler(new Request("https://backend.example", { method: "POST", headers: { authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" }, body }))).status).toBe(400);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("bounds actual UTF-8 body bytes and declared content length to 4 KiB", async () => {
    const { handler, fetchImpl } = setup();
    const raw = (body: string, length?: string) => new Request("https://backend.example", {
      method: "POST", headers: { authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", ...(length ? { "Content-Length": length } : {}) }, body,
    });
    expect((await handler(raw(`${" ".repeat(4094)}{}`))).status).toBe(200);
    expect((await handler(raw(`${" ".repeat(4095)}{}`))).status).toBe(400);
    expect((await handler(raw("{}", "4097"))).status).toBe(400);
    expect((await handler(raw(`{"checkHibpSubscription":false,"x":"${"é".repeat(2200)}"}`, "1"))).status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("performs exactly one fixed HIBP account request only on explicit true and returns an output allowlist", async () => {
    const { handler, fetchImpl, env } = setup({ provider: json({ ...subscription, ApiKey: hibpKey, Email: "private@example.com", Description: workerToken, Extra: serviceKey }) });
    const before = { ...env };
    const response = await handler(request({ checkHibpSubscription: true }));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.data.configuration.liveChecksPerformed).toBe(false); // configuration-only snapshot
    expect(data.data.accountChecks.hibpSubscription).toMatchObject({ requested: true, performed: true, result: {
      provider: "hibp", scope: "account_metadata", subscriptionName: "Pwned 1", subscribedUntil: "2027-05-01T00:00:00.000Z", rpm: 10, allowanceVerifiedByCheck: false,
    } });
    expect(Object.keys(data.data.accountChecks.hibpSubscription.result).sort()).toEqual(["allowanceVerifiedByCheck", "checkedAt", "provider", "rpm", "scope", "subscribedUntil", "subscriptionName"].sort());
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://haveibeenpwned.com/api/v3/subscription/status");
    expect(init.method || "GET").toBe("GET");
    expect(init.redirect).toBe("error");
    expect(init.headers).toMatchObject({ "hibp-api-key": hibpKey });
    expect(JSON.stringify(init)).not.toContain(serviceKey);
    expect(JSON.stringify(data)).not.toMatch(/private@example|fixture-|ApiKey|Description/);
    expect(env).toEqual(before);
  });

  it("does not call HIBP when its key is missing and never approves allowance", async () => {
    const { handler, fetchImpl } = setup({ env: { HIBP_API_KEY: "" } });
    const response = await handler(request({ checkHibpSubscription: true }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "CONFIGURATION_REQUIRED" }, data: {
      configuration: { hibp: { keyConfigured: false, includedAccessVerified: false } },
      accountChecks: { hibpSubscription: { requested: true, performed: false } },
    } });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sanitizes provider errors, propagates bounded rate limits and never retries", async () => {
    for (const [provider, status, code] of [
      [json({ message: hibpKey }, 401), 503, "PROVIDER_ACCESS_DENIED"],
      [json({ message: serviceKey }, 429, { "Retry-After": "13" }), 429, "RATE_LIMITED"],
      [json({ detail: workerToken }, 500), 502, "UPSTREAM_ERROR"],
      [json({ ...subscription, Rpm: -1, ApiKey: hibpKey }), 502, "INVALID_PROVIDER_RESPONSE"],
      [new Error(`connection ${serviceKey} ${hibpKey}`), 502, "UPSTREAM_UNAVAILABLE"],
      [new DOMException(hibpKey, "TimeoutError"), 504, "TIMEOUT"],
    ] as const) {
      const { handler, fetchImpl } = setup({ provider });
      const response = await handler(request({ checkHibpSubscription: true }));
      const text = await response.text();
      expect(response.status).toBe(status);
      expect(JSON.parse(text)).toMatchObject({ ok: false, error: { code }, data: { accountChecks: { hibpSubscription: { requested: true, performed: true } } } });
      for (const secret of [serviceKey, hibpKey, workerToken]) expect(text).not.toContain(secret);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      if (code === "RATE_LIMITED") expect(response.headers.get("Retry-After")).toBe("13");
    }
  });
});
