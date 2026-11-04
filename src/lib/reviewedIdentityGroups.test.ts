import { beforeEach, describe, expect, it, vi } from "vitest";
type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({ tables: {} as Record<string, Row[]>, writes: [] as { table: string; mode: string; rows: Row[] }[], fail: "" }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (table: string) => {
  const filters: [string, unknown][] = [];
  const inFilters: [string, unknown[]][] = [];
  let mode = "read", payload: Row[] = [], single = false, bounds: number[] | undefined;
  const q = {
    select: () => q, eq: (key: string, value: unknown) => { filters.push([key, value]); return q; },
    in: (key: string, values: unknown[]) => { inFilters.push([key, values]); return q; },
    order: () => q, single: () => { single = true; return q; }, range: (a: number, b: number) => { bounds = [a, b]; return q; },
    insert: (value: Row | Row[]) => { mode = "insert"; payload = Array.isArray(value) ? value : [value]; return q; },
    upsert: (value: Row | Row[]) => { mode = "upsert"; payload = Array.isArray(value) ? value : [value]; return q; },
    delete: () => { throw new Error("Historical records must not be deleted"); },
    then: (resolve: (value: unknown) => unknown) => {
      if (state.fail === table) return Promise.resolve({ data: null, error: new Error("SYNTHETIC database failure") }).then(resolve);
      const rows = state.tables[table] ??= [];
      let found = rows.filter(row => filters.every(([key, value]) => row[key] === value) && inFilters.every(([key, values]) => values.includes(row[key])));
      if (mode !== "read") {
        state.writes.push({ table, mode, rows: structuredClone(payload) });
        found = payload.map(row => {
          const previous = mode === "upsert" ? rows.find(saved => saved.cluster_id === row.cluster_id && saved.entity_id === row.entity_id) : undefined;
          if (previous) return Object.assign(previous, row);
          const next = { id: `${table}-${rows.length}`, ...row }; rows.push(next); return next;
        });
      }
      if (bounds) found = found.slice(bounds[0], bounds[1] + 1);
      return Promise.resolve({ data: single ? found[0] ?? null : found, error: null }).then(resolve);
    },
  };
  return q;
} } }));

import { runIdentityClustering } from "./clusteringEngine";
import { readResearchComparisons, runBehavioralSimilarity } from "./similarityEngine";
import { reviewedAccountGroups, reviewedMembershipReason, sourceContextComparisons, visibleReviewedClusters, REVIEWED_GROUP_PREFIX } from "./reviewedIdentityGroups";

function fixture(name: string, platformId: string, personaId = "person", supporting = `https://sample.org/${personaId}`) {
  const profile = { platform: "GitHub", platformId, accountId: `github:${platformId}`, username: name, profileUrl: `https://github.com/${name}`, sourceUrl: `https://api.github.com/users/${name}`, retrievedAt: "2026-11-04T00:00:00Z", existence: "found", personAssociation: "unreviewed", evidenceKind: "public_account" };
  const evidence = { classification: "analyst_supported_association", persona_id: personaId, account_id: profile.accountId, profile_url: profile.profileUrl, source_url: profile.sourceUrl, retrieved_at: profile.retrievedAt, lookup_result_id: `lookup-${name}`, review_id: `review-${name}`, supporting_source_url: supporting, reviewed_at: "2026-11-04T01:00:00Z" };
  const entity = { id: `entity-${name}`, user_id: "user", entity_type: "social_profile", entity_value: profile.profileUrl, metadata: { identity_evidence: evidence } };
  const lookup = { id: evidence.lookup_result_id, user_id: "user", tool_name: "public-profile-search", status: "success", created_at: profile.retrievedAt, result_data: { persona_id: personaId, schemaVersion: 2, status: "success", username: name, retrievedAt: profile.retrievedAt, profiles: [profile], checks: [{ platform: profile.platform, sourceUrl: profile.sourceUrl, retrievedAt: profile.retrievedAt, status: "found", profile }] } };
  const review = { id: evidence.review_id, user_id: "user", tool_name: "profile-association-review", status: "success", created_at: evidence.reviewed_at, result_data: { persona_id: personaId, account_id: profile.accountId, profile_url: profile.profileUrl, lookup_result_id: lookup.id, decision: "supported", reason: "The cited author page explicitly links this account.", supporting_source_url: supporting, reviewed_at: evidence.reviewed_at } };
  return { entity, lookup, review };
}
function populate(...items: ReturnType<typeof fixture>[]) {
  state.tables.identity_entities = items.map(item => item.entity);
  state.tables.tool_results = items.flatMap(item => [item.lookup, item.review]);
  state.tables.personas = [...new Set(items.map(item => item.review.result_data.persona_id))].map(id => ({ id, user_id: "user" }));
}
beforeEach(() => { state.tables = {}; state.writes = []; state.fail = ""; });

describe("source-bound reviewed groups", () => {
  it("does not cluster shared domains, names, infrastructure, legacy links or case membership", async () => {
    state.tables.identity_entities = [
      { id: "one", user_id: "user", entity_type: "email", entity_value: "alex@shared-company.org", metadata: {} },
      { id: "two", user_id: "user", entity_type: "email", entity_value: "other@shared-company.org", metadata: {} },
    ];
    state.tables.entity_observations = [{ entity_id: "one", case_id: "same", user_id: "user" }, { entity_id: "two", case_id: "same", user_id: "user" }];
    state.tables.identity_entity_links = [{ source_entity_id: "one", target_entity_id: "two", confidence_score: 1, relationship_type: "same_domain", user_id: "user" }];
    state.tables.infrastructure_links = [{ entity_id: "one", infrastructure_type: "ip", value: "shared-ip", source_tool: "live-dns", user_id: "user" }, { entity_id: "two", infrastructure_type: "ip", value: "shared-ip", source_tool: "live-dns", user_id: "user" }];
    expect(await runIdentityClustering("user")).toEqual({ clustersCreated: 0, entitiesClustered: 0 });
    expect(await runBehavioralSimilarity("user")).toEqual({ pairsScored: 0, highSimilarity: 0 });
    expect(state.writes).toEqual([]);
  });
  it("groups two explicit current associations with rationale, without fixed confidence or historical deletion", async () => {
    populate(fixture("alpha", "1"), fixture("beta", "2"));
    const legacy = { id: "legacy", user_id: "user", cluster_label: "Old generated cluster", cluster_score: 90 };
    state.tables.identity_clusters = [legacy];
    expect(await runIdentityClustering("user")).toEqual({ clustersCreated: 1, entitiesClustered: 2 });
    expect(state.tables.identity_clusters).toContainEqual(legacy);
    expect(state.tables.identity_clusters[1]).toMatchObject({ cluster_score: 0, cluster_label: REVIEWED_GROUP_PREFIX + "person" });
    for (const member of state.tables.cluster_members) {
      expect(member.confidence_score).toBe(0);
      expect(JSON.parse(String(member.join_reason))).toMatchObject({ classification: "analyst_supported_group", persona_id: "person" });
    }
  });
  it("does not merge different reviewed people despite a shared supporting source or shared provider", async () => {
    populate(fixture("alpha", "1", "person-a", "https://sample.org/company"), fixture("beta", "2", "person-b", "https://sample.org/company"));
    expect(await runIdentityClustering("user")).toEqual({ clustersCreated: 0, entitiesClustered: 0 });
    expect(state.writes).toEqual([]);
  });
  it("does not recreate duplicates on repeat grouping", async () => {
    populate(fixture("alpha", "1"), fixture("beta", "2"));
    await runIdentityClustering("user");
    expect(await runIdentityClustering("user")).toEqual({ clustersCreated: 0, entitiesClustered: 2 });
    expect(state.tables.identity_clusters).toHaveLength(1);
    expect(state.tables.cluster_members).toHaveLength(2);
  });
  it("immediately excludes a rejected latest association even before entity metadata is updated", async () => {
    const alpha = fixture("alpha", "1"), beta = fixture("beta", "2"); populate(alpha, beta);
    state.tables.tool_results.push({ ...beta.review, id: "reject", created_at: "2026-11-04T02:00:00Z", result_data: { ...beta.review.result_data, decision: "rejected" } });
    expect(await runIdentityClustering("user")).toEqual({ clustersCreated: 0, entitiesClustered: 0 });
    expect(await readResearchComparisons("user")).toEqual([]);
    expect(state.writes).toEqual([]);
  });
  it("propagates failed membership persistence without returning a successful count", async () => {
    populate(fixture("alpha", "1"), fixture("beta", "2")); state.fail = "cluster_members";
    await expect(runIdentityClustering("user")).rejects.toThrow("SYNTHETIC database failure");
  });
  it("keeps old membership records hidden unless each binds the current review", () => {
    const { entity: a } = fixture("alpha", "1"), { entity: b } = fixture("beta", "2");
    const cluster = { id: "group", cluster_label: REVIEWED_GROUP_PREFIX + "person" };
    const members = [a, b].map(entity => ({ cluster_id: "group", entity_id: entity.id, join_reason: reviewedMembershipReason(entity) }));
    expect(visibleReviewedClusters([cluster], members, [a, b])).toEqual([cluster]);
    expect(visibleReviewedClusters([cluster], members.map(member => ({ ...member, join_reason: "same_email_domain" })), [a, b])).toEqual([]);
    expect(visibleReviewedClusters([cluster], members, [a])).toEqual([]);
    const updated = { ...b, metadata: { identity_evidence: { ...b.metadata.identity_evidence, review_id: "new-review" } } };
    expect(visibleReviewedClusters([cluster], members, [a, updated])).toEqual([]);
  });
  it("does not inflate a group by duplicate stable account IDs", () => {
    const { entity } = fixture("alpha", "1");
    const entities = [entity, { ...entity, id: "duplicate-row" }];
    expect(reviewedAccountGroups(entities)).toEqual([]);
    expect(visibleReviewedClusters([{ id: "group", cluster_label: REVIEWED_GROUP_PREFIX + "person" }], entities.map(item => ({ cluster_id: "group", entity_id: item.id, join_reason: reviewedMembershipReason(item) })), entities)).toEqual([]);
  });
  it("rejects metadata whose support link does not match the retained current review", async () => {
    const alpha = fixture("alpha", "1"), beta = fixture("beta", "2"); populate(alpha, beta);
    beta.entity.metadata.identity_evidence.supporting_source_url = "https://different-source.org/unrelated";
    expect(await runIdentityClustering("user")).toEqual({ clustersCreated: 0, entitiesClustered: 0 });
    expect(await readResearchComparisons("user")).toEqual([]);
    expect(state.writes).toEqual([]);
  });
  it("does not reactivate retained account evidence after its dossier is removed", async () => {
    populate(fixture("alpha", "1"), fixture("beta", "2"));
    const retained = structuredClone(state.tables.tool_results);
    state.tables.personas = [];
    expect(await runIdentityClustering("user")).toEqual({ clustersCreated: 0, entitiesClustered: 0 });
    expect(await readResearchComparisons("user")).toEqual([]);
    expect(state.tables.tool_results).toEqual(retained);
    expect(state.writes).toEqual([]);
  });
});

describe("source-context research comparisons", () => {
  it("records the concrete relationship and counts reused support as one source without a probability", async () => {
    populate(fixture("alpha", "1"), fixture("beta", "2"));
    const historical = { id: "old", user_id: "user", similarity_score: 0.99, analysis_method: "composite" };
    state.tables.similarity_scores = [historical];
    const rows = await readResearchComparisons("user");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ analysis_method: "reviewed_source_context_v1", similarity_score: 0, details: { classification: "research_lead", excluded_from_identity: true, excluded_from_reports: true } });
    expect(rows[0].details.signals).toEqual([expect.stringMatching(/same dossier/), expect.stringMatching(/one source/)]);
    expect(state.tables.similarity_scores).toEqual([historical]);
    expect(state.writes).toEqual([]);
  });
  it("does not infer similarity from names, shared providers or account URL patterns", () => {
    const a = fixture("alex-one", "1", "first-person").entity;
    const b = fixture("alex-two", "2", "second-person").entity;
    expect(sourceContextComparisons([a, b], "user")).toEqual([]);
  });
  it("does not read or mutate historical probability rows when comparing current evidence", async () => {
    populate(fixture("alpha", "1"), fixture("beta", "2"));
    expect(await runBehavioralSimilarity("user")).toEqual({ pairsScored: 1, highSimilarity: 0 });
    expect(state.tables.similarity_scores).toBeUndefined();
    expect(state.tables.identity_entity_links).toBeUndefined();
    expect(state.writes).toEqual([]);
  });
  it("keeps unavailable evidence reads as errors rather than empty findings", async () => {
    populate(fixture("alpha", "1"), fixture("beta", "2"));
    state.fail = "tool_results";
    await expect(readResearchComparisons("user")).rejects.toThrow("SYNTHETIC database failure");
  });
});
