import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { MARKETPLACE_REQUIRED_SECRETS, runMarketplaceLicensed } from "../../supabase/functions/osint-tools/marketplaceLicensed";

const keys = Object.fromEntries(Object.values(MARKETPLACE_REQUIRED_SECRETS).flat().map(key => [key, "fixture-key-never-live"]));
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
beforeEach(() => {
  vi.stubGlobal("Deno", { env: { get: (key: string) => keys[key] } });
  vi.stubGlobal("crypto", webcrypto);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("licensed marketplace providers", () => {
  it("returns no handler for arbitrary catalog descriptions", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect(await runMarketplaceLicensed("arbitrary-script", {})).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("reports exact missing secrets before sending a provider request", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("Deno", { env: { get: () => undefined } });
    await expect(runMarketplaceLicensed("caller-id", { phone: "+14155550123" })).rejects.toThrow("TWILIO_API_KEY, TWILIO_API_SECRET");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("preserves actual line type without inventing an SMS bypass result", async () => {
    const fetch = vi.fn().mockResolvedValue(response({ phone_number: "+14155550123", valid: true, line_type_intelligence: { type: "nonFixedVoip", carrier_name: "provider carrier", error_code: null } })); vi.stubGlobal("fetch", fetch);
    const result = await runMarketplaceLicensed("sms-detector", { phone: "+1 (415) 555-0123" });
    expect(new URL(fetch.mock.calls[0][0]).searchParams.get("Fields")).toBe("line_type_intelligence");
    expect(result?.line_type_intelligence).toMatchObject({ type: "nonFixedVoip", carrier_name: "provider carrier" });
    expect(result).not.toHaveProperty("bypass_detected");
    expect(result?.coverage).toContain("not proof");
  });
  it("rejects private image URLs and malformed bounds before provider calls", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(runMarketplaceLicensed("lpr", { image_url: "https://127.0.0.1/plate.png" })).rejects.toThrow("public HTTPS domain");
    await expect(runMarketplaceLicensed("lpr", { image_url: "http://images.example/plate.png" })).rejects.toThrow("public HTTPS domain");
    await expect(runMarketplaceLicensed("streetview-compare", { bbox: "-98,30,-97,31" })).rejects.toThrow("0.1 degrees");
    await expect(runMarketplaceLicensed("streetview-compare", { bbox: "-97.7,30.2,-97.8,30.3" })).rejects.toThrow("ordered");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("sends a genuine OCR request and preserves recognized provider plates", async () => {
    const fetch = vi.fn().mockResolvedValue(response({ success: true, results: [{ plate: "abc123", confidence: 0.94 }] })); vi.stubGlobal("fetch", fetch);
    const result = await runMarketplaceLicensed("lpr", { image_url: "https://images.example/plate.jpg" });
    expect(new URL(fetch.mock.calls[0][0]).pathname).toBe("/platerecognition");
    expect(fetch.mock.calls[0][1].method).toBe("POST");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ image_url: "https://images.example/plate.jpg" });
    expect(result?.result).toMatchObject({ results: [{ plate: "abc123", confidence: 0.94 }] });
    expect(JSON.stringify(result)).not.toContain("fixture-key-never-live");
  });
  it("honors explicit archive mode and the requested X endpoint", async () => {
    const fetch = vi.fn().mockResolvedValue(response({ data: [{ id: "observed-post", text: "actual fixture content", created_at: "2026-10-01T00:00:00Z" }], meta: { result_count: 1 } })); vi.stubGlobal("fetch", fetch);
    const result = await runMarketplaceLicensed("twitter-deep-search", { q: "from:example", mode: "all", size: 10 });
    expect(new URL(fetch.mock.calls[0][0]).pathname).toBe("/2/tweets/search/all");
    expect(result?.mode).toBe("all");
    expect(result?.posts).toMatchObject([{ id: "observed-post" }]);
  });
  it("uses real dated Mapillary records without asserting change detection", async () => {
    const fetch = vi.fn().mockResolvedValue(response({ data: [{ id: "image-record", captured_at: 1700000000000, geometry: { type: "Point", coordinates: [-97.75, 30.25] } }] })); vi.stubGlobal("fetch", fetch);
    const result = await runMarketplaceLicensed("streetview-compare", { bbox: "-97.78,30.22,-97.74,30.26", size: 5 });
    expect(result?.images).toMatchObject([{ id: "image-record", captured_at: 1700000000000 }]);
    expect(result?.coverage).toContain("not automatic historical change");
  });
  it("distinguishes a missing behavior report from new malware execution", async () => {
    const fetch = vi.fn().mockResolvedValue(response({ error: "not found" }, 404)); vi.stubGlobal("fetch", fetch);
    const result = await runMarketplaceLicensed("malware-sandbox", { hash: "a".repeat(64) });
    expect(result).toMatchObject({ found: false, report: null });
    expect(result?.coverage).toContain("Does not upload or detonate");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("reports quotas and invalid bodies as failures without leaking secrets or retrying", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response("URL contains fixture-key-never-live", { status: 429 })).mockResolvedValueOnce(new Response("not json")); vi.stubGlobal("fetch", fetch);
    await expect(runMarketplaceLicensed("vehicle-lookup", { plate: "ABC123", state: "TX" })).rejects.toThrow("HTTP 429");
    await expect(runMarketplaceLicensed("vehicle-lookup", { plate: "ABC123", state: "TX" })).rejects.toThrow("invalid JSON");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("signs organizational exposure queries and excludes leak bodies and credentials", async () => {
    const fetch = vi.fn().mockResolvedValue(response({ total: 1, results: [{ id: "public-source", title: "Organization mention", url: "https://source.example/report", body: "leak", password: "do-not-return", emails: ["private@example.org"] }] })); vi.stubGlobal("fetch", fetch);
    const result = await runMarketplaceLicensed("dark-web-monitor", { q: "tjksecurity.com", size: 1 });
    expect(fetch.mock.calls[0][1].headers.Authorization).toMatch(/^OWL fixture-key-never-live:[A-Za-z0-9+/=]+$/);
    expect(result?.results).toEqual([{ id: "public-source", title: "Organization mention", url: "https://source.example/report" }]);
    expect(JSON.stringify(result)).not.toContain("do-not-return");
    expect(JSON.stringify(result)).not.toContain("private@example.org");
    await expect(runMarketplaceLicensed("dark-web-monitor", { q: "person@example.org" })).rejects.toThrow("organization’s domain");
  });
  it("bounds provider body size instead of truncating a response into false success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("x".repeat(2_000_001))));
    await expect(runMarketplaceLicensed("public-records", { q: "copyright" })).rejects.toThrow("2 MB limit");
  });
});
