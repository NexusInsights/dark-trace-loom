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
    upsert: (rows: Record<string, unknown>[] | Record<string, unknown>) => { mode = "upsert"; payload = Array.isArray(rows) ? rows : [rows]; return query; },
    insert: (rows: Record<string, unknown>[] | Record<string, unknown>) => { mode = "insert"; payload = Array.isArray(rows) ? rows : [rows]; return query; },
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

beforeEach(() => { state.tables = { personas: [{ id: "person", user_id: "user" }, { id: "other-person", user_id: "user" }] }; state.failure = ""; });

const profile = { platform: "GitHub", platformId: "123", accountId: "github:123", username: "sampleuser", profileUrl: "https://github.com/sampleuser", sourceUrl: "https://api.github.com/users/sampleuser", retrievedAt: "2026-11-04T00:00:00Z", existence: "found", personAssociation: "unreviewed", evidenceKind: "public_account" };
const lookup = (overrides: Record<string, unknown> = {}) => ({ id: "lookup", user_id: "user", tool_name: "public-profile-search", status: "success", created_at: "2026-11-04T00:00:00Z", result_data: { persona_id: "person", schemaVersion: 2, status: "success", username: "sampleuser", retrievedAt: profile.retrievedAt, profiles: [profile], checks: [{ platform: profile.platform, sourceUrl: profile.sourceUrl, retrievedAt: profile.retrievedAt, status: "found", profile }] }, ...overrides });
const review = (decision = "supported", overrides: Record<string, unknown> = {}) => ({ id: "review", user_id: "user", tool_name: "profile-association-review", status: "success", created_at: "2026-11-04T01:00:00Z", result_data: { persona_id: "person", profile_url: profile.profileUrl, account_id: profile.accountId, lookup_result_id: "lookup", decision, supporting_source_url: "https://sample.org/author", reason: "The source explicitly links this profile from the subject's published author page.", reviewed_at: "2026-11-04T01:00:00Z", ...overrides } });

describe("saved identity evidence", () => {
  it("admits only an explicitly supported account association and retains its source and review provenance", async () => {
    state.tables.tool_results = [lookup(), review()];
    expect(await runIdentityResolution("user")).toEqual({ entitiesResolved: 1, linksCreated: 0 });
    expect(state.tables.identity_entities).toEqual([expect.objectContaining({ entity_type: "social_profile", entity_value: profile.profileUrl, confidence_score: 0, metadata: expect.objectContaining({ identity_evidence: expect.objectContaining({ classification: "analyst_supported_association", account_id: profile.accountId, persona_id: "person", lookup_result_id: "lookup", review_id: "review", source_url: profile.sourceUrl, retrieved_at: profile.retrievedAt }) }) })]);
    expect(state.tables.entity_observations).toHaveLength(1);
  });

  it("requires a review bound to the actual lookup, stable account and same person", async () => {
    for (const change of [{ account_id: "github:999" }, { lookup_result_id: "missing" }, { persona_id: "different-person" }, { supporting_source_url: "https://127.0.0.1/private" }, { reason: "" }]) {
      state.tables = { personas: [{id:"person",user_id:"user"}], tool_results: [lookup(), review("supported", change)] };
      expect(await runIdentityResolution("user")).toEqual({ entitiesResolved: 0, linksCreated: 0 });
    }
  });

  it("lets the latest rejection revoke a prior supported association without deleting the saved account or review", async () => {
    state.tables.tool_results = [lookup(), review()];
    await runIdentityResolution("user");
    state.tables.tool_results.push({ ...review("rejected"), id: "reject", created_at: "2026-11-04T02:00:00Z" });
    expect(await runIdentityResolution("user")).toEqual({ entitiesResolved: 0, linksCreated: 0 });
    expect(state.tables.identity_entities).toHaveLength(1);
    expect(state.tables.identity_entities[0].metadata).toMatchObject({ resolution_excluded: true });
    expect(state.tables.tool_results).toHaveLength(3);
  });

  it("never resolves unreviewed, demo, failed, legacy or generated account-shaped records", async () => {
    const scenarios = [lookup(), lookup({ status: "demo" }), lookup({ status: "error" }), lookup({ result_data: { persona_id: "person", profiles: [{ ...profile, accountId: undefined }] } }), lookup({ tool_name: "username-candidates" })];
    for (const row of scenarios) {
      state.tables = { personas: [{id:"person",user_id:"user"}], tool_results: [row, ...(row === scenarios[0] ? [] : [review()])] };
      expect(await runIdentityResolution("user")).toEqual({ entitiesResolved: 0, linksCreated: 0 });
    }
  });

  it("does not create identity links from substring matches or a shared handle", async () => {
    state.tables.identity_entities = [{ id: "manual", user_id: "user", entity_type: "email", entity_value: "sampleuser-other@sample.org", source_tool: "manual", metadata: {} }];
    state.tables.tool_results = [lookup(), review()];
    expect((await runIdentityResolution("user")).linksCreated).toBe(0);
    expect(state.tables.identity_entity_links ?? []).toEqual([]);
  });
  it("keeps conflicting associations of the same stable account to different people out of resolved output", async () => {
    state.tables.tool_results = [lookup(), review(), lookup({id:'second-lookup',result_data:{...(lookup().result_data),persona_id:'other-person'}}),{...review('supported',{persona_id:'other-person',lookup_result_id:'second-lookup'}),id:'second-review'}];
    expect(await runIdentityResolution('user')).toEqual({entitiesResolved:0,linksCreated:0});
    expect(state.tables.tool_results).toHaveLength(4);
  });
  it("preserves review history but excludes an account after its investigated person is deleted", async () => {
    state.tables.tool_results=[lookup(),review()];
    expect((await runIdentityResolution('user')).entitiesResolved).toBe(1);
    state.tables.personas=[];
    expect(await runIdentityResolution('user')).toEqual({entitiesResolved:0,linksCreated:0});
    expect(state.tables.tool_results).toHaveLength(2);
    expect(state.tables.identity_entities[0].metadata).toMatchObject({resolution_excluded:true});
  });
  it("keeps supplied inputs and same-handle account observations out of resolved person identities", async () => {
    state.tables.persona_identifiers = [
      { id: "p1", user_id: "user", identifier_type: "username", identifier_value: "@sampleuser", source: "input" },
      { id: "p2", user_id: "user", identifier_type: "email", identifier_value: "sampleuser@sample.org", source: "live:provider" },
    ];
    const result = await runIdentityResolution("user");
    expect(result).toEqual({ entitiesResolved: 0, linksCreated: 0 });
    expect(state.tables.identity_entities ?? []).toEqual([]);
    expect(state.tables.entity_observations ?? []).toEqual([]);
  });

  it("keeps generic successful results and provider match suggestions as source records, not person associations", async () => {
    state.tables.tool_results = [
      { id: "r1", user_id: "user", status: "completed", tool_name: "lookup", result_data: { email: "real@sample.org", sourceUrl: "https://api.vendor.org", checks: [{ email: "absent@wrong.org", status: "not_found" }], ai_interpretation: "invented@fiction.org" } },
      { id: "r2", user_id: "user", status: "failed", result_data: { email: "failed@wrong.org" } },
      { id: "r3", user_id: "user", status: null, result_data: { error: "unavailable", email: "error@wrong.org" } },
    ];
    state.tables.pdl_lookups = [{ id: "lookup1", user_id: "user", result: { email: "pdl@sample.org" } }];
    await runIdentityResolution("user");
    expect(state.tables.identity_entities ?? []).toEqual([]);
    expect(state.tables.pdl_lookups).toHaveLength(1);
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

  it("does not resolve an unreviewed provider record or interpret its notices as identity evidence", async () => {
    state.tables.pdl_lookups = [{ id: "lookup", user_id: "user", result: {
      linkedin_url: "linkedin.com/in/sampleuser", linkedin_username: "sampleuser",
      provider_notice: "See https://api.provider.org or call 12345678901", birth_date: "1990-01-01",
    } }];
    const result = await runIdentityResolution("user");
    expect(state.tables.identity_entities ?? []).toEqual([]);
    expect(result.linksCreated).toBe(0);
  });

  it("does not duplicate entities, links or observations on a repeated run", async () => {
    state.tables.tool_results = [lookup(), review()];
    await runIdentityResolution("user");
    const counts = [state.tables.identity_entities.length, (state.tables.identity_entity_links ?? []).length, state.tables.entity_observations.length];
    await runIdentityResolution("user");
    expect([state.tables.identity_entities.length, (state.tables.identity_entity_links ?? []).length, state.tables.entity_observations.length]).toEqual(counts);
  });

  it("reads subsequent evidence pages instead of silently stopping at a server limit", async () => {
    state.tables.tool_results = [...Array.from({ length: 501 }, (_, i) => ({ id: `p${i}`, user_id: "user", tool_name: "unused", status: "success", result_data: {} })), lookup(), review()];
    expect((await runIdentityResolution("user")).entitiesResolved).toBe(1);
    expect(state.tables.entity_observations).toHaveLength(1);
  });

  it("propagates database failures instead of reporting zero or success", async () => {
    state.failure = "tool_results";
    await expect(runIdentityResolution("user")).rejects.toMatchObject({ message: "tool_results unavailable" });
    expect(state.tables.identity_entities).toBeUndefined();
  });

  it("rejects missing users before reading or writing", async () => {
    await expect(runIdentityResolution(" ")).rejects.toThrow("Sign in");
    expect(Object.keys(state.tables)).toEqual(["personas"]);
  });
});
