import { beforeEach, describe, expect, it, vi } from "vitest";
const { invoke, getSession } = vi.hoisted(() => ({ invoke: vi.fn(), getSession: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke }, auth: { getSession } } }));
import { getMarketplaceStatus, getMarketplaceStatuses, marketplaceRemoteTools } from "./marketplaceRemoteTools";

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ data: { session: null }, error: null });
});

function tool(id: string) {
  const found = marketplaceRemoteTools.find(tool => tool.id === id);
  if (!found) throw new Error(`Unknown tool ${id}`);
  return found;
}

describe("marketplace provider contracts", () => {
  it("sends exact dispatcher inputs and preserves returned evidence", async () => {
    const evidence = { source: "https://vpic.nhtsa.dot.gov/api/vehicles", retrieved_at: "2026-10-12T12:00:00Z", vehicle: { Make: "HONDA" } };
    invoke.mockResolvedValue({ data: evidence, error: null });
    const result = await tool("vin-decoder").process({ vin: "1HGCM82633A004352" });
    expect(invoke).toHaveBeenCalledWith("osint-tools", expect.objectContaining({ body: { action: "marketplace-run", params: { tool: "vin-decoder", inputs: { vin: "1HGCM82633A004352" } } } }));
    expect(result.details).toMatchObject(evidence);
  });

  it("preserves the actual non-2xx provider reason and never automatically retries", async () => {
    invoke.mockResolvedValue({ data: null, error: { context: new Response(JSON.stringify({ error: "Provider HTTP 403: account not entitled" }), { status: 403 }) } });
    await expect(tool("caller-id").process({ phone: "+14155552671" })).rejects.toThrow("Provider HTTP 403: account not entitled");
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("does not turn provider-configuration failures or empty responses into usable findings", async () => {
    invoke.mockResolvedValueOnce({ data: { status: "provider_configuration_required", reason: "Missing authorized API key" }, error: null });
    await expect(tool("malware-sandbox").process({ hash: "a".repeat(64) })).rejects.toThrow("Missing authorized API key");
    invoke.mockResolvedValueOnce({ data: {}, error: null });
    await expect(tool("ip-reputation").process({ ip: "8.8.8.8" })).rejects.toThrow("no usable");
  });

  it("uses only the read-only configuration route for readiness", async () => {
    invoke.mockResolvedValue({ data: { tools: { "caller-id": { configured: false, missing_secrets: ["TWILIO_API_KEY"], provider: "Twilio", scope: "US CNAM" } } }, error: null });
    const status = await getMarketplaceStatus("caller-id");
    expect(status).toEqual({ configured: false, missing_secrets: ["TWILIO_API_KEY"], source: "Twilio", coverage: "US CNAM" });
    expect(invoke).toHaveBeenCalledWith("osint-tools", expect.objectContaining({ body: { action: "marketplace-status", params: {} } }));
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("fails closed on absent or malformed tool readiness", async () => {
    invoke.mockResolvedValueOnce({ data: { tools: {} }, error: null });
    await expect(getMarketplaceStatus("caller-id")).rejects.toThrow("No deployed marketplace");
    invoke.mockResolvedValueOnce({ data: { tools: { "caller-id": { configured: "yes", missing_secrets: [] } } }, error: null });
    await expect(getMarketplaceStatuses()).rejects.toThrow("configuration for caller-id is invalid");
  });

  it.each(["sentiment-analysis", "translation"])("accepts keyless %s readiness while preserving a backend-required static-key failure", async id => {
    expect(tool(id).integration?.requiredSecrets).toEqual(["AI_CHAT_COMPLETIONS_URL", "AI_MODEL"]);
    invoke.mockResolvedValueOnce({ data: { tools: { [id]: { configured: true, missing_secrets: [], provider: "Cloudflare Workers AI", scope: "Verified user session" } } }, error: null });
    await expect(getMarketplaceStatus(id)).resolves.toMatchObject({ configured: true, missing_secrets: [] });
    invoke.mockResolvedValueOnce({ data: { tools: { [id]: { configured: false, missing_secrets: ["AI_API_KEY"], provider: "Independent AI provider", scope: "Explicit static API-key mode" } } }, error: null });
    await expect(getMarketplaceStatus(id)).resolves.toMatchObject({ configured: false, missing_secrets: ["AI_API_KEY"] });
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls.every(([, options]) => options.body.action === "marketplace-status")).toBe(true);
  });

  it("matches server credential names and preserves narrow integration scope", () => {
    expect(tool("caller-id").integration?.requiredSecrets).toEqual(["TWILIO_API_KEY", "TWILIO_API_SECRET"]);
    expect(tool("lpr").integration?.requiredSecrets).toEqual(["CARSXE_API_KEY"]);
    expect(tool("twitter-deep-search").integration?.requiredSecrets).toEqual(["X_API_BEARER_TOKEN"]);
    expect(tool("malware-sandbox").description).toContain("no file upload");
    expect(tool("blockchain-tracer").description).toContain("Bitcoin mainnet");
    expect(tool("streetview-compare").fields.some(field => field.key === "latitude")).toBe(true);
  });

  it("will not open a TCP connection request without explicit authorization", async () => {
    await expect(tool("port-scanner-pro").process({ ip: "203.0.113.7", ports: "80,443", authorization_confirmed: "false" })).rejects.toThrow("Explicit authorization");
    expect(getSession).not.toHaveBeenCalled();
  });

  it("uses the existing same-origin session for a configured TCP probe", async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: "test-session-only" } }, error: null });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ source: "Cloudflare TCP sockets", observed_at: "2026-10-12T12:00:00Z", ports: [{ port: 443, status: "open", elapsed_ms: 45 }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const result = await tool("port-scanner-pro").process({ ip: "203.0.113.7", ports: "443", authorization_confirmed: "true" });
      expect(fetchMock).toHaveBeenCalledWith("/api/marketplace-port-scan", expect.objectContaining({ method: "POST", body: JSON.stringify({ ip: "203.0.113.7", ports: "443", authorization_confirmed: true }) }));
      expect(result.details.ports).toEqual([{ port: 443, status: "open", elapsed_ms: 45 }]);
      expect(JSON.stringify(result)).not.toContain("test-session-only");
    } finally { vi.unstubAllGlobals(); }
  });
});
