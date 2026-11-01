// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { isBlockedAddress, safeFetch } from "../../supabase/functions/_shared/safeFetch";
import { requireUser } from "../../supabase/functions/_shared/requireUser";
let network: ReturnType<typeof vi.fn>;
beforeEach(() => { network = vi.fn(); vi.stubGlobal("fetch", network); vi.stubGlobal("Deno", { env: { get: (name: string) => name === "SUPABASE_URL" ? "https://project.supabase.co" : name === "SUPABASE_ANON_KEY" ? "unit-test-placeholder" : undefined } }); });
afterEach(() => vi.unstubAllGlobals());
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const dns = () => response({ Answer: [{ type: 5, data: "alias.example" }, { type: 1, data: "93.184.215.14" }] });
describe("authentication", () => {
  it.each([undefined, "Bearer", "Basic abc"])("rejects absent/malformed authorization: %s", async authorization => {
    expect(await requireUser(new Request("https://example.com", { headers: authorization ? { Authorization: authorization } : {} }))).toBe(false); expect(network).not.toHaveBeenCalled();
  });
  it("validates an actual user response instead of accepting any bearer/anon key", async () => {
    network.mockResolvedValue(response({ id: "user" })); expect(await requireUser(new Request("https://example.com", { headers: { Authorization: "Bearer test-session" } }))).toBe(true);
    network.mockResolvedValue(response({ error: "invalid" }, 401)); expect(await requireUser(new Request("https://example.com", { headers: { Authorization: "Bearer anon-placeholder" } }))).toBe(false);
  });
  it("fails closed on network errors", async () => {
    network.mockRejectedValue(new Error("offline")); expect(await requireUser(new Request("https://example.com", { headers: { Authorization: "Bearer test" } }))).toBe(false);
  });
});
describe("bounded fetch", () => {
  it.each(["127.0.0.1", "10.0.0.1", "172.16.1.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "224.0.0.1", "::1", "::", "fe90::1", "fc00::1", "fd12::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "0:0:0:0:0:ffff:7f00:1", "ff02::1"])("blocks %s", ip => expect(isBlockedAddress(ip)).toBe(true));
  it.each(["8.8.8.8", "93.184.215.14", "2606:4700:4700::1111"])("allows public %s", ip => expect(isBlockedAddress(ip)).toBe(false));
  it("blocks private URL literals before fetch", async () => { await expect(safeFetch("https://[::ffff:127.0.0.1]/")).rejects.toThrow("Blocked"); expect(network).not.toHaveBeenCalled(); });
  it("blocks HTTP and URL userinfo", async () => {
    await expect(safeFetch("http://example.com")).rejects.toThrow("non-HTTPS");
    await expect(safeFetch("https://name:password@example.com")).rejects.toThrow("credentials"); expect(network).not.toHaveBeenCalled();
  });
  it("rejects private DNS answers", async () => { network.mockImplementation(async () => response({ Answer: [{ type: 1, data: "10.0.0.1" }] })); await expect(safeFetch("https://example.com")).rejects.toThrow("Blocked"); expect(network).toHaveBeenCalledTimes(2); });
  it("ignores CNAME answers and fetches bounded public data", async () => {
    network.mockImplementation(async (url: string) => url.includes("cloudflare-dns") ? dns() : response({ ok: true }));
    expect(await (await safeFetch("https://example.com")).json()).toEqual({ ok: true }); expect(network).toHaveBeenCalledTimes(3);
  });
  it("validates redirect destinations and blocks private redirects", async () => {
    network.mockImplementation(async (url: string) => url.includes("cloudflare-dns") ? dns() : new Response(null, { status: 302, headers: { location: "https://127.0.0.1/" } }));
    await expect(safeFetch("https://example.com")).rejects.toThrow("Blocked"); expect(network).toHaveBeenCalledTimes(3);
  });
  it("never forwards provider credentials to a different origin", async () => {
    network.mockImplementation(async (url: string) => url.includes("cloudflare-dns") ? dns() : new Response(null, { status: 302, headers: { location: "https://other.example/" } }));
    await expect(safeFetch("https://example.com", { headers: { "X-Api-Key": "unit-test-placeholder" } })).rejects.toThrow("credential forwarding"); expect(network).toHaveBeenCalledTimes(3);
  });
  it("enforces the response body cap", async () => {
    network.mockImplementation(async (url: string) => url.includes("cloudflare-dns") ? dns() : new Response("12345"));
    await expect(safeFetch("https://example.com", { maxBytes: 4 })).rejects.toThrow("exceeded 4");
  });
  it("enforces redirect limits", async () => {
    network.mockImplementation(async (url: string) => url.includes("cloudflare-dns") ? dns() : new Response(null, { status: 302, headers: { location: "/loop" } }));
    await expect(safeFetch("https://example.com", { maxRedirects: 1 })).rejects.toThrow("Too many");
  });
});
