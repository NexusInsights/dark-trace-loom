import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

// Exercise the real backend function without starting Deno or spending provider credits.
const backend = readFileSync("supabase/functions/osint-tools/index.ts", "utf8");
const start = backend.indexOf("async function pdlPersonSearch(");
const end = backend.indexOf("async function pdlCompanyEnrich(", start);
const source = backend.slice(start, end)
  .replace("p: Record<string, unknown>", "p")
  .replace("const must: Array<Record<string, unknown>>", "const must")
  .split("field: string, val: unknown").join("field, val")
  .replace("d: Record<string, unknown>", "d");

function fixture(response: Response) {
  const fetch = vi.fn().mockResolvedValue(response);
  const timeout = vi.fn(() => new AbortController().signal);
  const run = new Function("fetch", "pdlKey", "PDL_BASE", "AbortSignal", `${source}; return pdlPersonSearch;`)(fetch, () => "test-key", "https://api.peopledatalabs.com/v5", {timeout});
  return {fetch, run, timeout};
}

describe("PDL Person Search request contract", () => {
  it("omits the deprecated from parameter even for the first page", async () => {
    const {fetch,run,timeout} = fixture(new Response(JSON.stringify({total:1, data:[{full_name:"fixture record"}],scroll_token:"next-token"})));
    const result = await run({name:"Fixture Name",size:"1",page:"1"});
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body).not.toHaveProperty("from");
    expect(body).not.toHaveProperty("page");
    expect(body).not.toHaveProperty("scroll_token");
    expect(body.size).toBe(1);
    expect(result.scroll_token).toBe("next-token");
    expect(result.returned).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(timeout).toHaveBeenCalledWith(20000);
  });
  it("passes the continuation token without offset pagination", async () => {
    const {fetch,run} = fixture(new Response(JSON.stringify({total:2,data:[],scroll_token:null})));
    const result = await run({name:"Fixture Name",scroll_token:"bookmark"});
    expect(JSON.parse(fetch.mock.calls[0][1].body).scroll_token).toBe("bookmark");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).not.toHaveProperty("from");
    expect(result.has_more).toBe(false);
  });
  it("rejects jumping to a legacy page without making a chargeable request", async () => {
    const {fetch,run} = fixture(new Response());
    await expect(run({name:"Fixture Name",page:"2"})).rejects.toThrow("continuation tokens");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("preserves a provider rejection and does not retry", async () => {
    const {fetch,run} = fixture(new Response(JSON.stringify({error:{message:"Account quota exceeded"}}),{status:429}));
    await expect(run({name:"Fixture Name"})).rejects.toThrow("PDL 429: Account quota exceeded");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("keeps contacts, street addresses and provider record IDs in the real backend response", async () => {
    const person = {id:"fixture-id",full_name:"Fixture",emails:[{address:"fixture@example.com"}],phone_numbers:["+15555550100"],location_street_address:"123 Fixture St",street_addresses:[{street_address:"123 Fixture St"}]};
    const {run} = fixture(new Response(JSON.stringify({total:1,data:[person]})));
    expect((await run({name:"Fixture",size:"1"})).matches[0]).toEqual(person);
  });
});
