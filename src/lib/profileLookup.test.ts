// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const session=vi.hoisted(()=>({get:vi.fn()}));
vi.mock("@/integrations/supabase/client",()=>({supabase:{auth:{getSession:session.get}}}));
import { lookupProfiles } from "./profileLookup";
import { searchPublicProfiles } from "./publicProfiles";
let value:Awaited<ReturnType<typeof searchPublicProfiles>>;
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json"}});
beforeEach(async()=>{session.get.mockReset();session.get.mockResolvedValue({data:{session:{access_token:"synthetic-session"}},error:null});value=await searchPublicProfiles({profileUrl:"https://github.com/fixture"},vi.fn(async()=>json({id:42,login:"fixture",html_url:"https://github.com/fixture"})));});
afterEach(()=>vi.unstubAllGlobals());
it("sends an exact profile seed through the existing same-origin route with the current session",async()=>{const transport=vi.fn(async()=>json(value));vi.stubGlobal("fetch",transport);expect(await lookupProfiles({profileUrl:"https://github.com/fixture"})).toEqual(value);const[url,init]=transport.mock.calls[0] as unknown as [string,RequestInit];expect(url).toBe("/api/profile-search");expect(JSON.parse(String(init.body))).toEqual({profileUrl:"https://github.com/fixture"});expect(new Headers(init.headers).get("Authorization")).toBe("Bearer synthetic-session");});
it("validates a seed before obtaining a session or sending requests",async()=>{const transport=vi.fn();vi.stubGlobal("fetch",transport);await expect(lookupProfiles({profileUrl:"https://evil.example/fixture"})).rejects.toThrow();expect(session.get).not.toHaveBeenCalled();expect(transport).not.toHaveBeenCalled();});
it("does no lookup without a current session",async()=>{session.get.mockResolvedValue({data:{session:null},error:null});const transport=vi.fn();vi.stubGlobal("fetch",transport);await expect(lookupProfiles("fixture")).rejects.toThrow("Sign in");expect(transport).not.toHaveBeenCalled();});
it.each(["status","id","source","checks"])("rejects a malformed fresh %s contract",async kind=>{const forged=structuredClone(value);if(kind==="status")forged.status="partial";if(kind==="id")forged.profiles[0].accountId="github:forged";if(kind==="source")forged.profiles[0].sourceUrl="https://evil.example/source";if(kind==="checks")forged.checks=[];vi.stubGlobal("fetch",vi.fn(async()=>json(forged)));await expect(lookupProfiles("fixture")).rejects.toThrow();});
it("retains a real non-2xx refusal rather than replacing it with empty success",async()=>{vi.stubGlobal("fetch",vi.fn(async()=>json({error:"Administrator disabled"},403)));await expect(lookupProfiles("fixture")).rejects.toThrow("Administrator disabled");});
it("bounds the returned response before parsing",async()=>{vi.stubGlobal("fetch",vi.fn(async()=>new Response("x".repeat(512*1024+1))));await expect(lookupProfiles("fixture")).rejects.toThrow("oversized");});
