import { describe, it, expect, vi } from "vitest";
import { searchPublicProfiles } from "./publicProfiles";

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
describe("source-backed public profile search", () => {
  it("uses Cloudflare-compatible redirect handling and rejects login redirects", async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => { expect(init?.redirect).toBe("manual"); return new Response(null,{status:302,headers:{Location:"https://example.com/login"}}); });
    const result = await searchPublicProfiles("missing", fetcher as unknown as typeof fetch);
    expect(result.profiles).toHaveLength(0);
    expect(result.checks.every(check => check.status === "unavailable" && check.reason?.includes("302"))).toBe(true);
  });
  it("requires actual account JSON and preserves canonical profile fields", async () => {
    const fetcher = vi.fn(async (url: string) => url.includes("api.github.com") ? json({ id: 1, login: "octocat", html_url: "https://github.com/octocat", name: "The Octocat", followers: 0, email: null }) : json(null,404));
    const result = await searchPublicProfiles("octocat", fetcher as unknown as typeof fetch);
    expect(result.profiles).toHaveLength(1);
    expect(result.profiles[0]).toMatchObject({ username: "octocat", profileUrl: "https://github.com/octocat", followers: 0 });
    expect(result.profiles[0].email).toBeUndefined();
    expect(result.profiles[0].retrievedAt).toBeTruthy();
  });
  it("never treats a login page or HTTP 200 soft-404 as an account", async () => {
    const result = await searchPublicProfiles("missing", vi.fn(async () => new Response("Sign in", { status: 200, headers: { "Content-Type": "text/html" } })) as unknown as typeof fetch);
    expect(result.profiles).toEqual([]);
    expect(result.checks.every(check => check.status === "unavailable")).toBe(true);
  });
  it("distinguishes not found from rate limits and request failures", async () => {
    const fetcher = vi.fn(async (url: string) => { if (url.includes("github")) return json({},429); if (url.includes("dev.to")) throw new Error("timeout"); if (url.includes("firebaseio")) return json(null); if (url.includes("gitlab")) return json([]); return json({ status: {code:0}, them:[null] }); });
    const result = await searchPublicProfiles("missing", fetcher as unknown as typeof fetch);
    expect(result.checks.map(check => check.status)).toEqual(["unavailable","unavailable","not_found","not_found","not_found"]);
    expect(result.profiles).toHaveLength(0);
  });
  it("rejects unrelated account records", async () => {
    const result = await searchPublicProfiles("requested", vi.fn(async () => json({ id: 1, login: "different", html_url:"https://github.com/different" })) as unknown as typeof fetch);
    expect(result.profiles).toHaveLength(0);
  });
  it("rejects malformed target inputs before making requests", async () => {
    const fetcher = vi.fn();
    await expect(searchPublicProfiles("https://target/",fetcher)).rejects.toThrow("exact username");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not invent emails or phone numbers from a handle", async () => {
    const result = await searchPublicProfiles("realuser", vi.fn(async (url: string) => url.includes("dev.to") ? json({ id: 2, username:"realuser", name:"Real User" }) : json(null,404)) as unknown as typeof fetch);
    expect(result.profiles[0].email).toBeUndefined();
    expect(result.profiles[0].phone).toBeUndefined();
  });
  it("preserves actual source photo URLs and creation dates without accepting executable image URLs", async () => {
    const result = await searchPublicProfiles("octocat", vi.fn(async (url: string) => url.includes("api.github.com") ? json({id:1,login:"octocat",html_url:"https://github.com/octocat",avatar_url:"https://avatars.githubusercontent.com/u/1",created_at:"2011-01-25T18:44:36Z"}) : url.includes("dev.to") ? json({id:2,username:"octocat",profile_image:"javascript:alert(1)"}) : json(null,404)) as unknown as typeof fetch);
    expect(result.profiles[0].avatarUrl).toBe("https://avatars.githubusercontent.com/u/1");expect(result.profiles[0].accountCreatedAt).toBe("2011-01-25T18:44:36Z");expect(result.profiles[1].avatarUrl).toBeUndefined();
  });
});
