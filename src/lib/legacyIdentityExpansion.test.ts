// @vitest-environment node
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const actor = "00000000-0000-4000-8000-000000000001";
const entityId = "00000000-0000-4000-8000-000000000002";
const foreignActor = "00000000-0000-4000-8000-000000000003";
const authSource = readFileSync(new URL("../../supabase/functions/_shared/authenticateUser.ts", import.meta.url), "utf8");
const handlerSource = readFileSync(new URL("../../supabase/functions/identity-expansion/index.ts", import.meta.url), "utf8");

function loadHandler(options: { authStatus?: number; anonymous?: boolean; owned?: boolean; databaseError?: boolean } = {}) {
  const requests: string[] = [];
  const tables: string[] = [];
  const filters: [string, unknown][] = [];
  const elevatedKeys: string[] = [];
  let handler!: (request: Request) => Promise<Response>;
  const code = ts.transpileModule(
    "const { authenticateUser, boundedJsonBody, RequestAuthenticationError } = (() => {\n"
      + authSource.replace(/^export /gm, "")
      + "\nreturn { authenticateUser, boundedJsonBody, RequestAuthenticationError }; })();\n"
      + handlerSource.replace(/^import .*;\r?\n/gm, ""),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } },
  ).outputText;
  const fetcher = async (url: string) => {
    requests.push(String(url));
    expect(String(url)).toBe("https://synthetic-auth.invalid/auth/v1/user");
    return new Response(JSON.stringify({ id: actor, role: "authenticated", is_anonymous: options.anonymous === true }), {
      status: options.authStatus ?? 200, headers: { "Content-Type": "application/json" },
    });
  };
  const createClient = (_url: string, key: string, configuration: { global: { headers: { Authorization: string } } }) => {
    expect(key).toBe("synthetic-public-key");
    expect(configuration.global.headers.Authorization).toBe("Bearer synthetic-session");
    return { from(table: string) {
      tables.push(table);
      expect(table).toBe("identity_entities");
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => { filters.push([column, value]); return query; },
        maybeSingle: async () => ({
          data: options.owned === false ? null : { id: entityId, entity_type: "username", entity_value: "synthetic.handle" },
          error: options.databaseError ? new Error("SYNTHETIC read failure") : null,
        }),
      };
      return query;
    } };
  };
  new vm.Script(code).runInNewContext({
    Request, Response, Headers, URL, AbortSignal, TextDecoder, Uint8Array, setTimeout, clearTimeout,
    fetch: fetcher, createClient,
    Deno: { env: { get: (key: string) => {
      if (key === "SUPABASE_SERVICE_ROLE_KEY") elevatedKeys.push(key);
      return ({ SUPABASE_URL: "https://synthetic-auth.invalid", SUPABASE_ANON_KEY: "synthetic-public-key" } as Record<string, string>)[key];
    } }, serve: (fn: typeof handler) => { handler = fn; } },
  });
  return { handler, requests, tables, filters, elevatedKeys };
}

function request(body: unknown = { entity_id: entityId, entity_type: "username", entity_value: "synthetic.handle", user_id: actor }, authorization = "Bearer synthetic-session") {
  return new Request("https://synthetic-handler.invalid", {
    method: "POST", headers: authorization ? { Authorization: authorization } : {}, body: JSON.stringify(body),
  });
}

describe("actual legacy identity-expansion handler with synthetic auth and SDK", () => {
  it("returns not_configured without inventing identities, contacts, clusters or findings", async () => {
    const fixture = loadHandler();
    const response = await fixture.handler(request());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.status).toBe("not_configured");
    expect(body.success).toBe(false);
    expect(body.results).toEqual({
      persona: { action: "unchanged" },
      permutations: { generated: 0, status: "not_configured" },
      linking: { links_created: 0, status: "not_configured" },
      clustering: { action: "unchanged", status: "not_configured" },
    });
    expect(fixture.tables).toEqual(["identity_entities"]);
    expect(fixture.filters).toEqual([["id", entityId], ["user_id", actor]]);
    expect(fixture.elevatedKeys).toEqual([]);
    expect(fixture.requests).toEqual(["https://synthetic-auth.invalid/auth/v1/user"]);
  });
  it.each(["", "synthetic-session", "Bearer one two"])("rejects malformed authentication %j before database access", async authorization => {
    const fixture = loadHandler();
    expect((await fixture.handler(request(undefined, authorization))).status).toBe(401);
    expect(fixture.tables).toEqual([]);
    expect(fixture.requests).toEqual([]);
  });
  it.each([401, 403, 500])("fails closed for authentication HTTP %d", async authStatus => {
    const fixture = loadHandler({ authStatus });
    expect((await fixture.handler(request())).status).toBe(authStatus === 500 ? 503 : 401);
    expect(fixture.tables).toEqual([]);
  });
  it("rejects anonymous sessions before ownership lookup", async () => {
    const fixture = loadHandler({ anonymous: true });
    expect((await fixture.handler(request())).status).toBe(403);
    expect(fixture.tables).toEqual([]);
  });
  it("rejects another user's supplied identity", async () => {
    const fixture = loadHandler();
    expect((await fixture.handler(request({ entity_id: entityId, entity_type: "username", entity_value: "synthetic.handle", user_id: foreignActor }))).status).toBe(403);
    expect(fixture.tables).toEqual([]);
  });
  it("does not accept a foreign or missing seed entity", async () => {
    const fixture = loadHandler({ owned: false });
    expect((await fixture.handler(request())).status).toBe(404);
    expect(fixture.filters).toContainEqual(["user_id", actor]);
  });
  it("retains a database failure instead of reporting no findings or success", async () => {
    const fixture = loadHandler({ databaseError: true });
    const response = await fixture.handler(request());
    expect(response.status).toBe(503);
    expect((await response.json()).reason).toBe("entity_access_unavailable");
  });
  it("rejects substituted seed content", async () => {
    const fixture = loadHandler();
    const response = await fixture.handler(request({ entity_id: entityId, entity_type: "email", entity_value: "not-an-observed-contact@example.invalid", user_id: actor }));
    expect(response.status).toBe(409);
    expect((await response.json()).reason).toBe("entity_input_mismatch");
  });
  it.each([null, [], {}, { entity_id: "bad-id" }])("rejects malformed input %j", async body => {
    const fixture = loadHandler();
    expect((await fixture.handler(request(body))).status).toBe(400);
    expect(fixture.tables).toEqual([]);
  });
  it("bounds the request before database access", async () => {
    const fixture = loadHandler();
    expect((await fixture.handler(request({ text: "x".repeat(5000) }))).status).toBe(413);
    expect(fixture.tables).toEqual([]);
  });
  it("handles preflight and rejects other methods without authentication or writes", async () => {
    const fixture = loadHandler();
    expect((await fixture.handler(new Request("https://synthetic-handler.invalid", { method: "OPTIONS" }))).status).toBe(204);
    expect((await fixture.handler(new Request("https://synthetic-handler.invalid"))).status).toBe(405);
    expect(fixture.requests).toEqual([]);
    expect(fixture.tables).toEqual([]);
  });
});
