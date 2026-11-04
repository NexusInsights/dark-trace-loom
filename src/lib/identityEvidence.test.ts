import { describe, it, expect } from "vitest";
import { filterCurrentIdentityEntities, isCurrentConnectivityScore, isResolvedIdentityEntity, supportedProfileAssociations, type SavedIdentityRecord } from "./identityEvidence";
import { personaDiscoverySchema } from "./validations";
const retrievedAt = "2026-11-04T00:00:00Z";
const profile = { platform: "GitHub", username: "sourceuser", platformId: "123", accountId: "github:123", profileUrl: "https://github.com/sourceuser", sourceUrl: "https://api.github.com/users/sourceuser", retrievedAt, evidenceKind: "public_account", existence: "found", personAssociation: "unreviewed" };
const records: SavedIdentityRecord[] = [
  { id: "lookup", tool_name: "public-profile-search", status: "success", created_at: retrievedAt, result_data: { persona_id: "person", schemaVersion: 2, status: "success", username: "sourceuser", retrievedAt, profiles: [profile], checks: [{ platform: "GitHub", sourceUrl: profile.sourceUrl, retrievedAt, status: "found", profile }] } },
  { id: "review", tool_name: "profile-association-review", status: "success", created_at: "2026-11-04T01:00:00Z", result_data: { persona_id: "person", profile_url: profile.profileUrl, account_id: profile.accountId, lookup_result_id: "lookup", decision: "supported", supporting_source_url: "https://sample.org/author", reason: "The original author page explicitly links the observed account.", reviewed_at: "2026-11-04T01:00:00Z" } },
];
const entity = () => ({ entity_type: "social_profile", entity_value: profile.profileUrl, metadata: { identity_evidence: supportedProfileAssociations(records)[0].evidence } });
describe("current source-bound identity admission", () => {
  it("binds resolved metadata to the actual profile entity, never an arbitrary copied row", () => {
    expect(isResolvedIdentityEntity(entity())).toBe(true);
    expect(isResolvedIdentityEntity({ ...entity(), entity_type: "email", entity_value: "unrelated@sample.org" })).toBe(false);
    expect(isResolvedIdentityEntity({ ...entity(), entity_value: "https://github.com/someoneelse" })).toBe(false);
  });
  it("revokes a persisted resolved row immediately when the latest review rejects it, without a resolver write", () => {
    const saved = entity();
    const rejected = { ...records[1], id: "reject", created_at: "2026-11-04T02:00:00Z", result_data: { ...(records[1].result_data as object), decision: "rejected" } };
    expect(filterCurrentIdentityEntities([saved], records)).toEqual([saved]);
    expect(filterCurrentIdentityEntities([saved], [...records, rejected])).toEqual([]);
    expect(saved.metadata.identity_evidence.review_id).toBe("review");
  });
  it("does not reuse an old accepted review when a later valid review returns to unreviewed", () => {
    const saved = entity(), reset = { ...records[1], id: "reset", created_at: "2026-11-04T02:00:00Z", result_data: { ...(records[1].result_data as object), decision: "unreviewed" } };
    expect(filterCurrentIdentityEntities([saved], [...records, reset])).toEqual([]);
  });
  it("rejects a source record whose stable account ID or actual source check no longer matches", () => {
    const source = records[0].result_data as Record<string, unknown>;
    const mismatched = { ...records[0], result_data: { ...source, profiles: [{ ...profile, accountId: "github:456" }] } };
    expect(supportedProfileAssociations([mismatched, records[1]])).toEqual([]);
  });
  it("requires an exact supported URL or username and preserves single-seed schema input", () => {
    expect(personaDiscoverySchema.parse({ profileUrl: profile.profileUrl }).profileUrl).toBe(profile.profileUrl);
    expect(personaDiscoverySchema.safeParse({ username: "sourceuser", profileUrl: profile.profileUrl }).success).toBe(false);
    expect(personaDiscoverySchema.safeParse({ profileUrl: "https://127.0.0.1/profile" }).success).toBe(false);
  });
  it("does not revive an old connectivity score after a new review supports the same entity again", () => {
    const saved={...entity(),id:'entity'};
    const evidence=saved.metadata.identity_evidence;
    const score={entity_id:'entity',score_reasons:[{factor:'Source-reviewed connectivity heuristic',review_id:evidence.review_id,account_id:evidence.account_id,lookup_result_id:evidence.lookup_result_id,supporting_source_url:evidence.supporting_source_url}]};
    expect(isCurrentConnectivityScore(score,saved)).toBe(true);
    expect(isCurrentConnectivityScore(score,{...saved,metadata:{identity_evidence:{...evidence,review_id:'new-review'}}})).toBe(false);
  });
});
