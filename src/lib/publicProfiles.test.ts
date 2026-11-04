import { describe, it, expect, vi } from "vitest";
import { searchPublicProfiles, isObservedPublicProfile, validateProfileSearchResult } from "./publicProfiles";

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
  it("preserves stable platform IDs and an explicit unreviewed person association", async () => {
    const result = await searchPublicProfiles({ profileUrl: "https://github.com/fixture" }, vi.fn(async () => json({ id: 42, login: "fixture", html_url: "https://github.com/fixture" })));
    expect(result).toMatchObject({ schemaVersion: 2, status: "success", inputProfileUrl: "https://github.com/fixture" });
    expect(result.profiles[0]).toMatchObject({ accountId: "github:42", platformId: "42", existence: "found", personAssociation: "unreviewed" });
    expect(isObservedPublicProfile(result.profiles[0])).toBe(true);
  });
  it("checks only the supplied known profile and never guesses other handles", async () => {
    const fetcher = vi.fn(async () => json({ id: 42, username: "fixture", name: "Fixture" }));
    const result = await searchPublicProfiles({ profileUrl: "https://dev.to/fixture" }, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1); expect(result.profiles.map(profile => profile.platform)).toEqual(["DEV Community"]);
  });
  it.each(["https://github.com/fixture/repos", "https://github.com.evil.example/fixture", "https://github.com/fixture?token=private", "https://localhost/fixture", "https://user:pass@github.com/fixture", "http://github.com/fixture"])("rejects unsupported or unsafe seed %s before traffic", async profileUrl => {
    const fetcher = vi.fn(); await expect(searchPublicProfiles({ profileUrl }, fetcher)).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects simultaneous username and profile URL seeds", async () => { const fetcher = vi.fn(); await expect(searchPublicProfiles({ username:"fixture", profileUrl:"https://github.com/fixture" },fetcher)).rejects.toThrow("exactly one");expect(fetcher).not.toHaveBeenCalled(); });
  it("does not accept a profile URL outside its authoritative platform record", async () => {
    const result = await searchPublicProfiles({ profileUrl: "https://github.com/fixture" }, vi.fn(async () => json({ id:42,login:"fixture",html_url:"https://evil.example/fixture" })));
    expect(result.status).toBe("error"); expect(result.profiles).toEqual([]); expect(result.checks[0].status).toBe("unavailable");
  });
  it("follows an actual DEV github_username link once and preserves both observations without person ownership", async () => {
    const fetcher = vi.fn(async (url:string) => url.includes("dev.to") ? json({ id:5,username:"devseed",github_username:"differenthandle" }) : json({ id:42,login:"differenthandle",html_url:"https://github.com/differenthandle",twitter_username:"linked_x" }));
    const result = await searchPublicProfiles({ profileUrl:"https://dev.to/devseed" }, fetcher as typeof fetch);
    expect(fetcher).toHaveBeenCalledTimes(2); expect(result.profiles.map(profile=>profile.accountId)).toEqual(["dev:5","github:42"]);
    expect(result.profiles[0].relatedProfiles?.[0]).toMatchObject({ profileUrl:"https://github.com/differenthandle",sourceAccountId:"dev:5",evidencePath:"github_username",observedValue:"differenthandle",relation:"links_to",targetExistence:"found",targetAccountId:"github:42" });
    expect(result.profiles.every(profile=>profile.personAssociation==="unreviewed")).toBe(true);
    expect(result.profiles[1].relatedProfiles?.[0]).toMatchObject({platform:"X",targetExistence:"unverified"});
    expect(fetcher.mock.calls.every(([url])=>!url.includes("x.com"))).toBe(true);
  });
  it("preserves Keybase reported proof provenance and ignores revoked or mismatched proofs", async () => {
    const fetcher=vi.fn(async(url:string)=>url.includes("keybase")?json({status:{code:0},them:[{id:"kb123",basics:{username:"fixture"},proofs_summary:{all:[{state:1,nametag:"linked",service_url:"https://github.com/linked",proof_type:"github"},{state:0,nametag:"revoked",service_url:"https://github.com/revoked"},{state:1,nametag:"wrong",service_url:"https://github.com/other"}]}}]}):json({id:42,login:"linked",html_url:"https://github.com/linked"}));
    const result=await searchPublicProfiles({profileUrl:"https://keybase.io/fixture"},fetcher as typeof fetch);
    expect(result.profiles[0].relatedProfiles).toHaveLength(1);expect(result.profiles[0].relatedProfiles?.[0]).toMatchObject({relation:"provider_reported_proof",sourceAccountId:"keybase:kb123",evidencePath:"proofs_summary.all[0].service_url",targetExistence:"found"});expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("preserves unavailable providers as partial while successful empty checks remain success", async () => {
    const result=await searchPublicProfiles("fixture",vi.fn(async(url:string)=>url.includes("github")?json({},429):json({},404)) as typeof fetch);
    expect(result.status).toBe("partial");expect(result.profiles).toEqual([]);
    expect((await searchPublicProfiles("fixture",vi.fn(async()=>json({},404)))).status).toBe("success");
  });
  it("bounds resolver provider bytes before parsing and does not follow redirects", async()=>{
    const result=await searchPublicProfiles({profileUrl:"https://github.com/fixture"},vi.fn(async()=>new Response("x".repeat(128*1024+1),{headers:{"Content-Type":"application/json"}})));
    expect(result.status).toBe("error");expect(result.checks[0].reason).toContain("oversized");
  });
  it("rejects forged statuses, IDs and source checks in fresh API responses", async()=>{
    const value=await searchPublicProfiles({profileUrl:"https://github.com/fixture"},vi.fn(async()=>json({id:42,login:"fixture",html_url:"https://github.com/fixture"})));
    expect(()=>validateProfileSearchResult({...value,status:"partial"})).toThrow("status");
    expect(()=>validateProfileSearchResult({...value,profiles:[{...value.profiles[0],accountId:"github:forged"}]})).toThrow();
    expect(()=>validateProfileSearchResult({...value,checks:[]})).toThrow();
    expect(isObservedPublicProfile({...value.profiles[0],personAssociation:"verified"})).toBe(false);
  });
  it("caps explicit proof pivots at five and retains unvisited links as unverified",async()=>{
    const fetcher=vi.fn(async(url:string)=>url.includes("keybase")?json({status:{code:0},them:[{id:"kb123",basics:{username:"fixture"},proofs_summary:{all:Array.from({length:20},(_,i)=>({state:1,nametag:`linked${i}`,service_url:`https://github.com/linked${i}`}))}}]}):json({id:100+Number(url.match(/linked(\d+)$/)?.[1]),login:url.split('/').at(-1),html_url:`https://github.com/${url.split('/').at(-1)}`}));
    const result=await searchPublicProfiles({profileUrl:"https://keybase.io/fixture"},fetcher as typeof fetch);
    expect(fetcher).toHaveBeenCalledTimes(6);expect(result.profiles).toHaveLength(6);expect(result.checks).toHaveLength(6);expect(result.profiles[0].relatedProfiles?.filter(link=>link.targetExistence==="found")).toHaveLength(5);expect(result.profiles[0].relatedProfiles?.filter(link=>link.targetExistence==="unverified")).toHaveLength(15);
  });
  it("does not crawl a second hop or retry an already checked account",async()=>{
    const fetcher=vi.fn(async(url:string)=>url.includes("dev.to")?json({id:5,username:"fixture",github_username:"linked"}):json({id:42,login:"linked",html_url:"https://github.com/linked",blog:"https://gitlab.com/further"}));
    const result=await searchPublicProfiles({profileUrl:"https://dev.to/fixture"},fetcher as typeof fetch);expect(fetcher).toHaveBeenCalledTimes(2);expect(result.profiles[1].relatedProfiles?.[0].targetExistence).toBe("unverified");
    const retry=vi.fn(async(url:string)=>url.includes("dev.to")?json({id:5,username:"fixture",github_username:"fixture"}):json({},404));
    const negative=await searchPublicProfiles("fixture",retry as typeof fetch);expect(retry).toHaveBeenCalledTimes(5);expect(negative.profiles[0].relatedProfiles?.[0].targetExistence).toBe("not_found");
  });
  it("refuses a forged found target claim without that target's own source observation",async()=>{
    const result=await searchPublicProfiles({profileUrl:"https://github.com/fixture"},vi.fn(async()=>json({id:42,login:"fixture",html_url:"https://github.com/fixture",twitter_username:"external"})));
    const forged=structuredClone(result);forged.profiles[0].relatedProfiles![0].targetExistence="found";forged.profiles[0].relatedProfiles![0].targetAccountId="github:42";
    expect(()=>validateProfileSearchResult(forged)).toThrow("target");
  });
  it.each([
    {field:"displayName",value:{}},{field:"bio",value:["bad"]},{field:"location",value:42},{field:"email",value:{address:"fake@example.org"}},{field:"phone",value:false},
    {field:"followers",value:-1},{field:"followers",value:1.5},{field:"followers",value:"10"},{field:"followers",value:Infinity},
    {field:"website",value:"https://user:pass@example.org"},{field:"website",value:"https://127.0.0.1/private"},{field:"avatarUrl",value:"javascript:alert(1)"},{field:"avatarUrl",value:{}},
    {field:"accountCreatedAt",value:"2026-02-31T00:00:00Z"},{field:"accountCreatedAt",value:"not a date"},{field:"email",value:"x".repeat(321)},{field:"bio",value:"x".repeat(20001)},
  ])("rejects malformed optional fresh field $field",async({field,value})=>{
    const result=await searchPublicProfiles({profileUrl:"https://github.com/fixture"},vi.fn(async()=>json({id:42,login:"fixture",html_url:"https://github.com/fixture"})));
    expect(isObservedPublicProfile({...result.profiles[0],[field]:value})).toBe(false);
  });
  it("accepts bounded source scalars, zero followers and safe resource links",async()=>{
    const result=await searchPublicProfiles({profileUrl:"https://github.com/fixture"},vi.fn(async()=>json({id:42,login:"fixture",html_url:"https://github.com/fixture",followers:0,name:"Fixture",bio:"Recorded source text",location:"Public source label",email:"public@example.org",blog:"https://example.org/#about",avatar_url:"https://avatars.githubusercontent.com/u/42",created_at:"2011-01-25T18:44:36Z"})));
    expect(isObservedPublicProfile(result.profiles[0])).toBe(true);expect(result.profiles[0].followers).toBe(0);
  });
  it("binds seed platform, source check timestamps and optional link text",async()=>{
    const result=await searchPublicProfiles({profileUrl:"https://github.com/fixture"},vi.fn(async()=>json({id:42,login:"fixture",html_url:"https://github.com/fixture",twitter_username:"external"})));
    expect(()=>validateProfileSearchResult({...result,inputProfileUrl:"https://gitlab.com/fixture"})).toThrow("seed");
    const time=structuredClone(result);time.checks[0].retrievedAt="2026-01-01T00:00:00Z";expect(()=>validateProfileSearchResult(time)).toThrow("source check");
    const platform=structuredClone(result);platform.checks[0].platform="GitLab";expect(()=>validateProfileSearchResult(platform)).toThrow("source check");
    const text=structuredClone(result);Object.assign(text.profiles[0].relatedProfiles![0],{evidence:{malformed:true}});expect(()=>validateProfileSearchResult(text)).toThrow();
    const reason=structuredClone(result);Object.assign(reason.checks[0],{reason:{malformed:true}});expect(()=>validateProfileSearchResult(reason)).toThrow();
  });
});
