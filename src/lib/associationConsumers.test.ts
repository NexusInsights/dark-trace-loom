import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rows: {} as Record<string, unknown[]>,
  writes: [] as { table: string; operation: string; payload: unknown }[],
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (table: string) => {
  let operation = "read";
  let payload: unknown;
  const q = {
    select: () => q, eq: () => q, in: () => q, order: () => q, range: () => q,
    insert: (value: unknown) => { operation = "insert"; payload = value; return q; },
    upsert: (value: unknown) => { operation = "upsert"; payload = value; return q; },
    delete: () => { operation = "delete"; return q; },
    then: (resolve: (value: unknown) => unknown) => {
      if (operation !== "read") state.writes.push({ table, operation, payload });
      return Promise.resolve({ data: operation === "read" ? state.rows[table] ?? [] : [{ id: "saved" }], error: null }).then(resolve);
    },
  };
  return q;
} } }));
import { runCorrelationEngine } from "./correlationEngine";
import { runSocialGraphMining } from "./socialGraphEngine";
import { visibleCorrelationLeads, extractCorrelationObservations } from "./correlationEvidence";
import { visibleSocialGraphEdges } from "./socialGraphEvidence";
import type { SavedIdentityRecord } from "./identityEvidence";

beforeEach(() => {
  state.rows = { cases: [{ id: "case-a" }, { id: "case-b" }], personas: ["persona-a", "person-a", "person-b"].map(id => ({ id, user_id: "owner" })) };
  state.writes = [];
});
const artifact = (id: string, caseId: string, data: unknown) => ({ id, case_id: caseId, artifact_type: "pipeline:username-search", data: JSON.stringify(data) });
const profile = { platform: "GitHub", username: "observed-account", platformId: "42", accountId: "github:42", existence: "found", personAssociation: "unreviewed", evidenceKind: "public_account", profileUrl: "https://github.com/observed-account", sourceUrl: "https://api.github.com/users/observed-account", retrievedAt: "2026-11-04T00:00:00.000Z" };
const lookup = { status: "success", details: { schemaVersion: 2, status: "success", username: "observed-account", retrievedAt: profile.retrievedAt, profiles: [profile], checks: [{ status: "found", platform: "GitHub", sourceUrl: profile.sourceUrl, retrievedAt: profile.retrievedAt, profile }] } };

it("does not turn supplied subject notes into cross-case findings or pseudo artifact IDs", async () => {
  state.rows.subjects = [{ id: "subject-a", case_id: "case-a", name: "Person A", notes: "Investigate @invented" }, { id: "subject-b", case_id: "case-b", name: "Person B", notes: "Maybe @invented" }];
  expect(await runCorrelationEngine("owner")).toEqual({ correlationsFound: 0, identifiersScanned: 0 });
  expect(state.writes).toEqual([]);
});

it.each(["input", "not-found", "demo", "rejected"])("does not promote %s profile search data to a sourced correlation", async kind => {
  const data = kind === "input" ? { inputs: { username: "@invented" }, details: { profiles: [] } }
    : kind === "not-found" ? { status: "success", details: { username: "@invented", profiles: [], checks: [{ status: "not_found", sourceUrl: "https://api.github.com/users/invented" }] } }
    : kind === "demo" ? { ...lookup, status: "demo" }
    : { ...lookup, review: { decision: "rejected" } };
  state.rows.artifacts = [artifact("artifact-a", "case-a", data), artifact("artifact-b", "case-b", data)];
  expect((await runCorrelationEngine("owner")).correlationsFound).toBe(0);
  expect(state.writes).toEqual([]);
});

it("stores literal sourced account matches only as unassessed leads and preserves all old rows", async () => {
  state.rows.artifacts = [artifact("artifact-a", "case-a", lookup), artifact("artifact-b", "case-b", lookup)];
  const result = await runCorrelationEngine("owner");
  expect(result.correlationsFound).toBe(1);
  expect(state.writes.some(write => write.operation === "delete")).toBe(false);
  const inserted = state.writes.find(write => write.table === "cross_case_correlations" && write.operation === "insert")?.payload as Record<string, unknown>[];
  expect(inserted).toEqual([expect.objectContaining({ source_type: "username", source_value: "observed-account", relationship_type: "shared_username_lead", confidence: 0, source_artifact_id: "artifact-a", target_artifact_id: "artifact-b" })]);
});

it("does not turn legacy input/candidate entities or substring matches into social associations", async () => {
  state.rows.identity_entities = [{ id: "username", entity_type: "username", entity_value: "hub", metadata: { source: "input" } }, { id: "profile", entity_type: "social_profile", entity_value: "https://github.com/unrelated", metadata: {} }];
  state.rows.identity_entity_links = [{ source_entity_id: "username", target_entity_id: "profile", relationship_type: "shared_identifier", confidence_score: 0.8 }];
  expect(await runSocialGraphMining("owner")).toEqual({ entitiesAnalyzed: 0, edgesCreated: 0 });
  expect(state.writes).toEqual([]);
});

const reviewedEntity = (id: string, persona = "persona-a") => ({ id, entity_type: "social_profile", entity_value: `https://github.com/${id}`, metadata: { identity_evidence: {
  classification: "analyst_supported_association", persona_id: persona, account_id: `github:${id}`, profile_url: `https://github.com/${id}`, lookup_result_id: `lookup-${id}`, review_id: `review-${id}`,
  source_url: `https://api.github.com/users/${id}`, retrieved_at: profile.retrievedAt, supporting_source_url: "https://evidence.example.org/account-association", reviewed_at: "2026-11-04T01:00:00.000Z",
} } });
function reviewedRecords(id: string, persona = "persona-a"): SavedIdentityRecord[] {
  const observation = { ...profile, username: id, platformId: id, accountId: `github:${id}`, profileUrl: `https://github.com/${id}`, sourceUrl: `https://api.github.com/users/${id}` };
  return [
    { id: `lookup-${id}`, tool_name: "public-profile-search", status: "success", created_at: profile.retrievedAt, result_data: { ...lookup.details, persona_id: persona, username: id, profiles: [observation], checks: [{ platform: "GitHub", status: "found", sourceUrl: observation.sourceUrl, retrievedAt: profile.retrievedAt, profile: observation }] } },
    { id: `review-${id}`, tool_name: "profile-association-review", status: "success", created_at: "2026-11-04T01:00:00.000Z", result_data: { persona_id: persona, profile_url: observation.profileUrl, account_id: observation.accountId, lookup_result_id: `lookup-${id}`, decision: "supported", supporting_source_url: "https://evidence.example.org/account-association", reason: "SYNTHETIC explicit source-backed association review", reviewed_at: "2026-11-04T01:00:00.000Z" } },
  ];
}

it("records reviewed accounts for the same persona with review evidence and no invented probability", async () => {
  state.rows.identity_entities = [reviewedEntity("101"), reviewedEntity("202")];
  state.rows.tool_results = [...reviewedRecords("101"), ...reviewedRecords("202")];
  expect(await runSocialGraphMining("owner")).toEqual({ entitiesAnalyzed: 2, edgesCreated: 1 });
  const written = state.writes.find(write => write.table === "social_graph_edges")?.payload as Record<string, unknown>[];
  expect(written).toEqual([expect.objectContaining({ relationship_type: "analyst_supported_association", confidence_score: 0, source_tool: "profile-association-review", metadata: expect.objectContaining({ confidence_assessed: false, persona_id: "persona-a" }) })]);
});

it("does not link reviewed accounts for different people merely because old links exist", async () => {
  state.rows.identity_entities = [reviewedEntity("101", "person-a"), reviewedEntity("202", "person-b")];
  state.rows.tool_results = [...reviewedRecords("101", "person-a"), ...reviewedRecords("202", "person-b")];
  state.rows.identity_entity_links = [{ source_entity_id: "101", target_entity_id: "202", relationship_type: "same_identity", confidence_score: 1 }];
  expect(await runSocialGraphMining("owner")).toEqual({ entitiesAnalyzed: 2, edgesCreated: 0 });
  expect(state.writes).toEqual([]);
});

it("suppresses unsupported graph endpoints and relabels retained legacy communication as unverified", () => {
  const source = reviewedEntity("101"), target = reviewedEntity("202");
  const records = [...reviewedRecords("101"), ...reviewedRecords("202")];
  const legacy = { source, target, relationship_type: "communication", confidence_score: 1, metadata: {} };
  expect(visibleSocialGraphEdges([legacy], records)).toEqual([expect.objectContaining({ assessment: "unverified_lead", relationship_type: "unverified_association_lead" })]);
  expect(visibleSocialGraphEdges([{ ...legacy, source: { metadata: { resolution_excluded: true } } }], records)).toEqual([]);
  expect(visibleSocialGraphEdges([{ ...legacy, relationship_type: "analyst_supported_association", metadata: { assessment: "analyst_supported_association" } }], records)[0].assessment).toBe("reviewed_association");
});

it.each(["rejected", "unreviewed"])("immediately revokes a now-%s association without deleting legacy entities or rerunning the resolver", async decision => {
  const records = [...reviewedRecords("101"), ...reviewedRecords("202")];
  const review = records[1];
  records.push({ ...review, id: "new-decision", created_at: "2026-11-04T02:00:00.000Z", result_data: { ...(review.result_data as Record<string, unknown>), decision, reviewed_at: "2026-11-04T02:00:00.000Z" } });
  state.rows.identity_entities = [reviewedEntity("101"), reviewedEntity("202")];
  state.rows.tool_results = records;
  expect(await runSocialGraphMining("owner")).toEqual({ entitiesAnalyzed: 1, edgesCreated: 0 });
  expect(state.writes).toEqual([]);
  expect(visibleSocialGraphEdges([{ source: reviewedEntity("101"), target: reviewedEntity("202"), relationship_type: "analyst_supported_association", metadata: { assessment: "analyst_supported_association" } }], records)).toEqual([]);
});

it("retains deleted-person history but excludes its accounts from active social associations", async () => {
  state.rows.identity_entities = [reviewedEntity("101"), reviewedEntity("202")];
  state.rows.tool_results = [...reviewedRecords("101"), ...reviewedRecords("202")];
  state.rows.personas = [];
  expect(await runSocialGraphMining("owner")).toEqual({ entitiesAnalyzed: 0, edgesCreated: 0 });
  expect(state.writes).toEqual([]);
});

it("hides stale computed correlations and preserves only leads with current positive observations", () => {
  const lead = { source_artifact_id: "artifact-a", target_artifact_id: "artifact-b", source_type: "username", target_type: "username", source_value: "observed-account", target_value: "observed-account", relationship_type: "shared_username_lead", confidence: 0 };
  const artifacts = [artifact("artifact-a", "case-a", lookup), artifact("artifact-b", "case-b", lookup)];
  expect(visibleCorrelationLeads([lead], artifacts)).toEqual([lead]);
  expect(visibleCorrelationLeads([{ ...lead, relationship_type: "shared_username", confidence: 1 }], artifacts)).toEqual([]);
  expect(visibleCorrelationLeads([lead], [artifacts[0], artifact("artifact-b", "case-b", { ...lookup, status: "error" })])).toEqual([]);
});

it("rejects a mismatched source or missing stable account identity and never mines biography text", () => {
  expect(extractCorrelationObservations(JSON.stringify({ ...lookup, details: { ...lookup.details, profiles: [{ ...profile, platformId: undefined }] } }))).toEqual([]);
  expect(extractCorrelationObservations(JSON.stringify({ ...lookup, details: { ...lookup.details, checks: [{ ...lookup.details.checks[0], sourceUrl: "https://api.github.com/users/different" }] } }))).toEqual([]);
  expect(extractCorrelationObservations(JSON.stringify({ ...lookup, details: { ...lookup.details, profiles: [{ ...profile, bio: "@invented fake@example.org" }] } }))).toEqual([{ type: "username", value: "observed-account", sourceUrl: profile.sourceUrl, retrievedAt: profile.retrievedAt }]);
});

it("does not insert duplicate cross-case lead records or delete any original row", async () => {
  state.rows.artifacts = [artifact("artifact-a", "case-a", lookup), artifact("artifact-b", "case-b", lookup)];
  state.rows.cross_case_correlations = [{ source_artifact_id: "artifact-a", target_artifact_id: "artifact-b", source_case_id: "case-a", target_case_id: "case-b", source_type: "username", target_type: "username", source_value: "observed-account", target_value: "observed-account", relationship_type: "shared_username_lead", confidence: 0 }];
  expect((await runCorrelationEngine("owner")).correlationsFound).toBe(1);
  expect(state.writes).toEqual([]);
});
