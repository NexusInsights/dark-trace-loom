import { beforeEach, describe, expect, it, vi } from "vitest";
import { associationReviewPayload, saveProfileAssociationReview, type AssociationReviewInput } from "./profileAssociationReview";
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), from: vi.fn(), insert: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { getUser: mocks.getUser }, from: mocks.from } }));
const input: AssociationReviewInput = { personaId: "persona-one", lookupResultId: "lookup-one", accountId: "github:123", profileUrl: "https://github.com/example", decision: "supported", supportingSourceUrl: "https://example.org/about", reason: "The supplied public biography explicitly links this exact account; names alone were not used." };
const observedProfile = { platform: "GitHub", username: "example", accountId: input.accountId, platformId: "123", profileUrl: input.profileUrl, existence: "found", personAssociation: "unreviewed", evidenceKind: "public_account", sourceUrl: "https://api.github.com/users/example", retrievedAt: "2026-11-04T00:00:00Z" };
const lookup = { persona_id: input.personaId, schemaVersion: 2, status: "success", username: "example", retrievedAt: observedProfile.retrievedAt, profiles: [observedProfile], checks: [{ platform: "GitHub", sourceUrl: observedProfile.sourceUrl, retrievedAt: observedProfile.retrievedAt, status: "found", profile: observedProfile }] };

describe("source-bound association reviews", () => {
  it("preserves concrete provenance while limiting the claim to analyst support", () => {
    const result = associationReviewPayload(input, lookup, "2026-11-04T01:00:00Z");
    expect(result).toMatchObject({ account_id: "github:123", lookup_result_id: "lookup-one", decision: "supported", observed_source_url: lookup.profiles[0].sourceUrl, supporting_source_url: input.supportingSourceUrl, reason: input.reason });
    expect(result.limitation).toContain("not independently verified");
    expect(result).not.toHaveProperty("confidence_score");
  });
  it("rejects a different persona or a guessed account not returned by the source", () => {
    expect(() => associationReviewPayload(input, { ...lookup, persona_id: "another-persona" })).toThrow(/does not belong/);
    expect(() => associationReviewPayload({ ...input, accountId: "github:guessed" }, lookup)).toThrow(/fresh account/);
    expect(() => associationReviewPayload({ ...input, profileUrl: "https://github.com/other" }, lookup)).toThrow(/fresh account/);
  });
  it("does not promote historical records without stable source identities", () => {
    expect(() => associationReviewPayload(input, { ...lookup, profiles: [{ profileUrl: input.profileUrl }] })).toThrow(/fresh account/);
  });
  it.each(["", "javascript:alert(1)", "https://localhost/test", "https://127.0.0.1/test", "https://user:password@example.org/"])("rejects missing or unsafe supporting source %s", url => {
    expect(() => associationReviewPayload({ ...input, supportingSourceUrl: url }, lookup)).toThrow();
  });
  it("requires a meaningful reason, and does not accept a fabricated verified state", () => {
    expect(() => associationReviewPayload({ ...input, reason: "same name" }, lookup)).toThrow(/Explain/);
    expect(() => associationReviewPayload({ ...input, decision: "verified" as never }, lookup)).toThrow(/valid review/);
  });
  it.each(["rejected", "unreviewed"] as const)("preserves %s without claiming supporting evidence", decision => {
    expect(associationReviewPayload({ ...input, decision, supportingSourceUrl: "", reason: "Conflicting source biographies; ownership cannot be established." }, lookup).decision).toBe(decision);
  });
});

describe("review persistence boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: "actor" } }, error: null });
    mocks.insert.mockResolvedValue({ data: null, error: null });
    mocks.from.mockImplementation((table: string) => {
      const chain = { select: vi.fn(), eq: vi.fn(), single: vi.fn(), insert: mocks.insert };
      chain.select.mockReturnValue(chain); chain.eq.mockReturnValue(chain);
      chain.single.mockResolvedValue({ data: table === "personas" ? { id: input.personaId } : { id: input.lookupResultId, result_data: lookup }, error: null });
      return chain;
    });
  });
  it("stops an unverifiable actor before any record read or write", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "different" } }, error: null });
    await expect(saveProfileAssociationReview("actor", input)).rejects.toThrow(/account could not be verified/);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("does not report success when storing a review fails", async () => {
    mocks.insert.mockResolvedValue({ data: null, error: new Error("RLS denied write") });
    await expect(saveProfileAssociationReview("actor", input)).rejects.toThrow("RLS denied write");
  });
  it("appends a source-bound assessment without updating or deleting observations", async () => {
    await saveProfileAssociationReview("actor", input);
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ user_id: "actor", tool_name: "profile-association-review", result_data: expect.objectContaining({ account_id: input.accountId, decision: "supported" }) }));
    expect(mocks.from.mock.calls.map(call => call[0])).toEqual(["personas", "tool_results", "tool_results"]);
  });
});
