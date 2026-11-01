import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runMarketplacePublic } from "../../supabase/functions/osint-tools/marketplacePublic";

beforeEach(() => vi.stubGlobal("AbortSignal", { timeout: () => undefined }));
afterEach(() => vi.unstubAllGlobals());
describe("marketplace public integrations", () => {
  it("does not route unknown catalog data", async () => { expect(await runMarketplacePublic("arbitrary-advertisement", {})).toBeUndefined(); });
  it("rejects malformed VIN and coordinates before calling any provider", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(runMarketplacePublic("vin-decoder", { vin: "1INVALID" })).rejects.toThrow("17-character VIN");
    await expect(runMarketplacePublic("satellite-search", { bbox: "-97,30,-98,31" })).rejects.toThrow("Bounding box");
    await expect(runMarketplacePublic("satellite-search", { latitude: "", longitude: "" })).rejects.toThrow("both latitude and longitude");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("preserves NHTSA decode warnings and never invents ownership or history", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ Results: [{ Make: "BMW", ErrorCode: "1", ErrorText: "Check digit does not calculate properly" }] }), { headers: { "Content-Type": "application/json" } })));
    const result = await runMarketplacePublic("vin-decoder", { vin: "5UXWX7C5XBA744634" });
    expect(result?.vehicle).toMatchObject({ Make: "BMW", ErrorCode: "1" });
    expect(result).not.toHaveProperty("accident_history"); expect(result?.notice).toContain("does not supply ownership");
  });
  it("reports provider denial as a failed request without a synthetic fallback", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Forbidden", { status: 403 })));
    await expect(runMarketplacePublic("vin-decoder", { vin: "5UXWX7C5XBA744634" })).rejects.toThrow("HTTP 403");
  });
  it("sends spatial and cloud filters to Earth Search and preserves real assets", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ features: [{ id: "provider-scene", assets: { thumbnail: { href: "https://provider.example/scene.jpg" } } }], links: [] }), { headers: { "Content-Type": "application/json" } })); vi.stubGlobal("fetch", fetch);
    const result = await runMarketplacePublic("satellite-search", { bbox: "-97.8,30.2,-97.7,30.3", max_cloud_cover: 20, limit: 1 });
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ bbox: [-97.8, 30.2, -97.7, 30.3], query: { "eo:cloud_cover": { lte: 20 } } });
    expect(result?.scenes).toEqual([{ id: "provider-scene", collection: undefined, bbox: undefined, geometry: undefined, properties: undefined, assets: { thumbnail: { href: "https://provider.example/scene.jpg" } }, links: undefined }]);
  });
  it("removes SEC XSL path only for raw XML and parses disclosed transaction values", async () => {
    const fetch = vi.fn(async (url: string) => new Response(url.includes("submissions") ? JSON.stringify({ cik: "320193", name: "Apple", filings: { recent: { form: ["4"], accessionNumber: ["0001140361-26-039158"], primaryDocument: ["xslF345X06/form4.xml"], filingDate: ["2026-10-08"] } } }) : '<ownershipDocument><reportingOwner><rptOwnerName>Filer</rptOwnerName></reportingOwner><nonDerivativeTransaction><transactionDate><value>2026-10-06</value></transactionDate><transactionShares><value>100</value></transactionShares><transactionCode>S</transactionCode><transactionPricePerShare><value>200.50</value></transactionPricePerShare></nonDerivativeTransaction></ownershipDocument>', { headers: { "Content-Type": url.includes("submissions") ? "application/json" : "application/xml" } })); vi.stubGlobal("fetch", fetch);
    const result = await runMarketplacePublic("insider-tracker", { cik: "320193", limit: 1 });
    expect(fetch.mock.calls[1][0]).toBe("https://www.sec.gov/Archives/edgar/data/320193/000114036126039158/form4.xml");
    expect((result?.filings as Record<string, unknown>[])[0].transactions).toMatchObject([{ transaction_date: "2026-10-06", shares: "100", transaction_code: "S", price_per_share: "200.50" }]);
  });
  it("labels incomplete sanctions coverage and preserves exact provider matches", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("scsanctions")) return new Response("Unavailable", { status: 503 });
      if (url.includes("webgate")) return new Response('<export generationDate="2026-10-12"><sanctionEntity euReferenceNumber="EU.1"><nameAlias wholeName="Listed Company"/><regulation numberTitle="2026/1"></regulation></sanctionEntity></export>');
      if (url.endsWith("SDN.CSV")) return new Response('1,"Listed Company",-0-,"SANCTION",-0-,-0-,-0-,-0-,-0-,-0-,-0-,"Public remarks"\r\n');
      if (url.endsWith("CONS_PRIM.CSV")) return new Response('2,"Other Company",-0-,"NS",-0-,-0-,-0-,-0-,-0-,-0-,-0-,-0-\r\n');
      return new Response("");
    }));
    const result = await runMarketplacePublic("sanctions-screening", { name: "Listed Company" });
    expect(result?.status).toBe("partial"); expect(result?.total_candidates).toBe(2);
    expect(result?.coverage).toMatchObject([{ list: "ofac", status: "checked" }, { list: "un", status: "failed" }, { list: "eu", status: "checked" }]);
    expect(result?.notice).toContain("partial coverage cannot establish a negative result");
  });
});
