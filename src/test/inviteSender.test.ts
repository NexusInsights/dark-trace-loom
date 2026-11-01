import { readFileSync } from "node:fs";
import ts from "typescript";
import { z } from "zod";
import { describe, expect, it, vi } from "vitest";

// Controlled exact-handler contracts only. No database or mail provider is
// called, and these tests do not claim a live message was sent or delivered.
const source = readFileSync("supabase/functions/invite-member/index.ts", "utf8")
  .replace(/^import .*;\r?\n/gm, "")
  .replace(/^export /gm, "");
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const actor = { id: "11111111-1111-4111-8111-111111111111", email: "actor@example.test" };
const orgId = "22222222-2222-4222-8222-222222222222";
type Handler = (req: Request) => Promise<Response>;

function fixture(sender?: string) {
  const getUser = vi.fn().mockResolvedValue({ data: { user: actor }, error: null });
  const inserted = vi.fn(), removed = vi.fn();
  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = () => chain;
    chain.maybeSingle = vi.fn().mockResolvedValue({ data: table === "organization_members" ? { role: "admin" } : { name: "Controlled organization" }, error: null });
    chain.insert = (value: unknown) => { inserted(value); return chain; };
    chain.single = vi.fn().mockResolvedValue({ data: { id: "33333333-3333-4333-8333-333333333333", expires_at: "2026-01-08T00:00:00Z" }, error: null });
    chain.delete = () => { removed(); return chain; };
    return chain;
  });
  const createClient = vi.fn((_url: string, key: string) => key === "public-fixture" ? { auth: { getUser } } : { from });
  const env: Record<string, string | undefined> = {
    SUPABASE_URL: "https://owned-backend.example.test", SUPABASE_ANON_KEY: "public-fixture", SUPABASE_SERVICE_ROLE_KEY: "server-fixture",
    RESEND_API_KEY: "controlled-mail-key", APP_ORIGIN: "https://owned-app.example.test", RESEND_FROM_EMAIL: sender,
  };
  const safeFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "controlled-provider-receipt" }), { status: 200 }));
  let handler: Handler | undefined;
  const helpers = new Function("serve", "createClient", "z", "safeFetch", "Deno", "crypto", `${js};return {invitationSender};`)(
    (value: Handler) => { handler = value; }, createClient, z, safeFetch, { env: { get: (name: string) => env[name] } },
    { randomUUID: () => "44444444-4444-4444-8444-444444444444" },
  );
  return { ...helpers, handler: handler!, safeFetch, inserted, removed, getUser, createClient };
}
const request = () => new Request("https://owned-app.example.test/invite-member", { method: "POST", headers: { Authorization: "Bearer controlled-token", Origin: "https://owned-app.example.test" }, body: JSON.stringify({ org_id: orgId, email: "recipient@example.test", role: "investigator" }) });

describe("invitation sender configuration", () => {
  it("preserves the exact legacy sender when the setting is missing", () => {
    expect(fixture().invitationSender(undefined)).toBe("TJK Security <invites@tjksecurity.com>");
  });
  it.each(["noreply@tjk-security.com", "Invites+Team@tjk-security.com"])("preserves the exact configured bare address %s", (sender) => {
    expect(fixture().invitationSender(sender)).toBe(`TJK Security <${sender}>`);
  });
  it.each(["", " ", "not-an-email", "noreply@", "@tjk-security.com", " sender@tjk-security.com", "sender@tjk-security.com ",
    "TJK Security <sender@tjk-security.com>", "sender@tjk-security.com,other@example.test", "sender@tjk-security.com\r\nBcc:other@example.test",
    "sender\n@tjk-security.com", "sender\0@tjk-security.com", null, 123])("fails closed for invalid sender/header input %#", (sender) => {
    expect(() => fixture().invitationSender(sender)).toThrow("RESEND_FROM_EMAIL must be one valid bare email address.");
  });
  it.each([undefined, "noreply@tjk-security.com", "Invites+Team@tjk-security.com"])("passes only the resolved sender to the actual provider body %#", async (sender) => {
    const f = fixture(sender); const response = await f.handler(request());
    expect(response.status).toBe(200); expect(f.safeFetch).toHaveBeenCalledTimes(1);
    expect(f.safeFetch.mock.calls[0][0]).toBe("https://api.resend.com/emails");
    const body = JSON.parse(f.safeFetch.mock.calls[0][1].body);
    expect(body.from).toBe(`TJK Security <${sender ?? "invites@tjksecurity.com"}>`);
    expect(body.to).toEqual(["recipient@example.test"]); expect(f.inserted).toHaveBeenCalledTimes(1);
  });
  it.each(["", "sender@tjk-security.com\r\nBcc:other@example.test", "TJK Security <sender@tjk-security.com>"])("rejects invalid configuration before invitation mutation or provider call %#", async (sender) => {
    const f = fixture(sender); const response = await f.handler(request());
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: "invalid_sender_configuration", reason: "RESEND_FROM_EMAIL must be one valid bare email address." });
    expect(f.inserted).not.toHaveBeenCalled(); expect(f.removed).not.toHaveBeenCalled(); expect(f.safeFetch).not.toHaveBeenCalled();
  });
});
