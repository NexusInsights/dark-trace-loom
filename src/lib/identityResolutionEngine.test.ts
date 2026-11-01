import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ tables: {} as Record<string, Record<string, unknown>[]>, failure: "" }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from(table: string) {
  let mode = "read";
  let payload: Record<string, unknown>[] = [];
  let bounds: [number, number] | undefined;
  const filters: [string, unknown][] = [];
  const query = {
    select: () => query,
    order: () => query,
    eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
    in: () => query,
    range: (start: number, end: number) => { bounds = [start, end]; return query; },
    upsert: (rows: Record<string, unknown>[]) => { mode = "upsert"; payload = rows; return query; },
    insert: (rows: Record<string, unknown>[]) => { mode = "insert"; payload = rows; return query; },
    update: (row: Record<string, unknown>) => { mode = "update"; payload = [row]; return query; },
    then(resolve: (value: unknown) => unknown) {
      if (state.failure === table) return Promise.resolve({ data: null, error: { message: `${table} unavailable` } }).then(resolve);
      const rows = state.tables[table] ??= [];
      let result = rows.filter(row => filters.every(([key, value]) => row[key] === value));
      if (mode === "update") result = result.map(row => Object.assign(row, payload[0]));
      else if (mode !== "read") result = payload.map(row => {
        const existing = mode === "upsert" ? rows.find(r => table === "identity_entities"
          ? r.user_id === row.user_id && r.entity_type === row.entity_type && r.entity_value === row.entity_value
          : r.source_entity_id === row.source_entity_id && r.target_entity_id === row.target_entity_id && r.relationship_type === row.relationship_type) : undefined;
        if (existing) return Object.assign(existing, row);
        const saved = { id: `${table}-${rows.length}`, ...row }; rows.push(saved); return saved;
      });
      if (bounds) result = result.slice(bounds[0], bounds[1] + 1);
      return Promise.resolve({ data: result, error: null }).then(resolve);
    },
  };
  return query;
} } }));

import { runIdentityResolution } from "./identityResolutionEngine";

beforeEach(() => { state.tables = {}; state.failure = ""; });

describe("saved identity evidence", () => {
  it("resolves declared and retrieved persona identifiers without any cases or artifacts", async () => {
    state.tables.persona_identifiers = [
      { id: "p1", user_id: "user", identifier_type: "username", identifier_value: "@sampleuser", source: "input" },
      { id: "p2", user_id: "user", identifier_type: "email", identifier_value: "sampleuser@sample.org", source: "live:provider" },
    ];
    const result = await runIdentityResolution("user");
    expect(result.entitiesResolved).toBe(3);
    expect(result.linksCreated).toBe(2);
    expect(state.tables.entity_observations).toHaveLength(3);
    expect(state.tables.entity_observations.every(o => o.case_id === null && String(o.source_tool).startsWith("persona_identifier:"))).toBe(true);
  });

  it("includes successful saved tools and PDL evidence but excludes AI interpretations and failures", async () => {
    state.tables.tool_results = [
      { id: "r1", user_id: "user", status: "completed", tool_name: "lookup", result_data: { email: "real@sample.org", sourceUrl: "https://api.vendor.org", checks: [{ email: "absent@wrong.org", status: "not_found" }], ai_interpretation: "invented@fiction.org" } },
      { id: "r2", user_id: "user", status: "failed", result_data: { email: "failed@wrong.org" } },
      { id: "r3", user_id: "user", status: null, result_data: { error: "unavailable", email: "error@wrong.org" } },
    ];
    state.tables.pdl_lookups = [{ id: "lookup1", user_id: "user", result: { email: "pdl@sample.org" } }];
    await runIdentityResolution("user");
    const emails = state.tables.identity_entities.filter(e => e.entity_type === "email").map(e => e.entity_value);
    expect(emails).toEqual(["real@sample.org", "pdl@sample.org"]);
    expect(state.tables.identity_entities.some(e => e.entity_value === "api.vendor.org")).toBe(false);
  });

  it("does not promote generated candidates or another user's records", async () => {
    state.tables.persona_identifiers = [
      { id: "p1", user_id: "user", identifier_type: "email", identifier_value: "fake@sample.org", source: "generated_permutation" },
      { id: "p2", user_id: "other", identifier_type: "email", identifier_value: "private@sample.org", source: "input" },
      { id: "p3", user_id: "user", identifier_type: "username", identifier_value: "inventeduser", source: "username_variation" },
    ];
    expect(await runIdentityResolution("user")).toEqual({ entitiesResolved: 0, linksCreated: 0 });
  });

  it("quarantines obsolete resolver output without deleting original records or unrelated entities", async () => {
    state.tables.identity_entities = [
      { id: "derived", user_id: "user", entity_type: "username", entity_value: "inventeduser", source_tool: "persona_identifier:p3", metadata: { preserved: true } },
      { id: "original", user_id: "user", entity_type: "username", entity_value: "manual", source_tool: "manual", metadata: {} },
    ];
    await runIdentityResolution("user");
    expect(state.tables.identity_entities).toHaveLength(2);
    expect(state.tables.identity_entities[0].metadata).toMatchObject({ preserved: true, resolution_excluded: true });
    expect(state.tables.identity_entities[1].metadata).toEqual({});
  });

  it("extracts typed provider usernames and full LinkedIn profile paths, excluding notices", async () => {
    state.tables.pdl_lookups = [{ id: "lookup", user_id: "user", result: {
      linkedin_url: "linkedin.com/in/sampleuser", linkedin_username: "sampleuser",
      provider_notice: "See https://api.provider.org or call 12345678901", birth_date: "1990-01-01",
    } }];
    const result = await runIdentityResolution("user");
    expect(state.tables.identity_entities.map(e => e.entity_value)).toContain("https://linkedin.com/in/sampleuser");
    expect(state.tables.identity_entities.some(e => e.entity_value === "api.provider.org" || e.entity_type === "phone")).toBe(false);
    expect(result.linksCreated).toBe(1);
  });

  it("does not duplicate entities, links or observations on a repeated run", async () => {
    state.tables.persona_identifiers = [{ id: "p1", user_id: "user", identifier_type: "email", identifier_value: "real@sample.org", source: "input" }];
    await runIdentityResolution("user");
    const counts = [state.tables.identity_entities.length, state.tables.identity_entity_links.length, state.tables.entity_observations.length];
    await runIdentityResolution("user");
    expect([state.tables.identity_entities.length, state.tables.identity_entity_links.length, state.tables.entity_observations.length]).toEqual(counts);
  });

  it("reads subsequent evidence pages instead of silently stopping at a server limit", async () => {
    state.tables.persona_identifiers = Array.from({ length: 501 }, (_, i) => ({ id: `p${i}`, user_id: "user", identifier_type: "username", identifier_value: "samehandle", source: "input" }));
    expect((await runIdentityResolution("user")).entitiesResolved).toBe(1);
    expect(state.tables.entity_observations).toHaveLength(501);
  });

  it("propagates database failures instead of reporting zero or success", async () => {
    state.failure = "persona_identifiers";
    await expect(runIdentityResolution("user")).rejects.toMatchObject({ message: "persona_identifiers unavailable" });
    expect(state.tables.identity_entities).toBeUndefined();
  });

  it("rejects missing users before reading or writing", async () => {
    await expect(runIdentityResolution(" ")).rejects.toThrow("Sign in");
    expect(state.tables).toEqual({});
  });
});
