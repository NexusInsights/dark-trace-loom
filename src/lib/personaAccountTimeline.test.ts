import { beforeEach, describe, expect, it, vi } from "vitest";
import { supportedProfileAssociations, type SavedIdentityRecord } from "./identityEvidence";
import { buildPersonaTimeline } from "./personaTimelineEngine";
import { useMapPlatformAccounts as mapPlatformAccountsHook, usePlatformAccounts as platformAccountsHook } from "../hooks/usePlatformAccounts";
import { usePersonaEvents as personaEventsHook } from "../hooks/usePersonaEvents";

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({ rows: {} as Record<string, Row[]>, writes: [] as Array<{ table: string; kind: string; rows: Row[] }> }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "owner" } }) }));
vi.mock("@tanstack/react-query", () => ({ useQuery: (options: unknown) => options, useMutation: (options: unknown) => options, useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (table: string) => {
  const filters: Array<[string, unknown]> = [], inclusions: Array<[string, unknown[]]> = []; let pending: Row[] | null = null; let kind = ""; let range: [number, number] | null = null;
  const query = {
    select: () => query, eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
    order: () => query, not: () => query, like: () => query, abortSignal: () => query,
    in: (key: string, values: unknown[]) => { inclusions.push([key, values]); return query; },
    range: (start: number, end: number) => { range = [start, end]; return query; },
    insert: (rows: Row[]) => { pending = rows; kind = "insert"; return query; },
    upsert: (rows: Row[]) => { pending = rows; kind = "upsert"; return query; },
    delete: () => { pending = []; kind = "delete"; return query; },
    then: (resolve: (value: unknown) => unknown) => {
      if (pending) { const rows = pending.map((row, index) => ({ ...row, id: `saved-${state.writes.length}-${index}` })); state.writes.push({ table, kind, rows }); return Promise.resolve({ data: rows, error: null }).then(resolve); }
      let rows = (state.rows[table] || []).filter(row => filters.every(([key, value]) => row[key] === value) && inclusions.every(([key, values]) => values.includes(row[key])));
      if (range) rows = rows.slice(range[0], range[1] + 1);
      return Promise.resolve({ data: rows, error: null }).then(resolve);
    },
  }; return query;
} } }));

const observedAt = "2026-11-04T00:00:00Z", reviewedAt = "2026-11-04T01:00:00Z", createdAt = "2015-01-01T00:00:00Z";
const profile = { platform: "GitHub", username: "sourceuser", platformId: "123", accountId: "github:123", profileUrl: "https://github.com/sourceuser", sourceUrl: "https://api.github.com/users/sourceuser", retrievedAt: observedAt, evidenceKind: "public_account", existence: "found", personAssociation: "unreviewed", accountCreatedAt: createdAt };
function ledger(accountCreatedAt: string | null = createdAt): SavedIdentityRecord[] {
  const account = { ...profile, accountCreatedAt: accountCreatedAt || undefined };
  return [
    { id: "lookup", tool_name: "public-profile-search", status: "success", created_at: observedAt, result_data: { persona_id: "person", schemaVersion: 2, status: "success", username: "sourceuser", retrievedAt: observedAt, profiles: [account], checks: [{ platform: "GitHub", sourceUrl: account.sourceUrl, retrievedAt: observedAt, status: "found", profile: account }] } },
    { id: "review", tool_name: "profile-association-review", status: "success", created_at: reviewedAt, result_data: { persona_id: "person", profile_url: account.profileUrl, account_id: account.accountId, lookup_result_id: "lookup", decision: "supported", supporting_source_url: "https://sample.org/author", reason: "The original author page explicitly links the observed account.", reviewed_at: reviewedAt } },
  ];
}
function setRecords(records: SavedIdentityRecord[]) {
  state.rows.tool_results = records.map(row => ({ ...row, user_id: "owner" }));
  const evidence = supportedProfileAssociations(records)[0]?.evidence;
  state.rows.identity_entities = [{ id: "entity", user_id: "owner", entity_type: "social_profile", entity_value: profile.profileUrl, created_at: "2026-11-04T10:00:00Z", metadata: evidence ? { identity_evidence: evidence } : null }];
  return evidence;
}
function accountRow(metadata: unknown = state.rows.identity_entities[0].metadata): Row {
  return { id: "account", user_id: "owner", persona_id: "person", platform_name: "github.com", platform_category: "public_profile", account_identifier: "github:123", profile_url: profile.profileUrl, metadata, confidence_score: 0, verified: false };
}
function eventRow(overrides: Row = {}): Row {
  return { id: "event", user_id: "owner", persona_id: "person", event_type: "account_observed", event_timestamp: observedAt, event_label: "Account record retrieved: GitHub sourceuser (analyst-supported association)", source: profile.sourceUrl, metadata: { ...state.rows.identity_entities[0].metadata as Row, entity_id: "entity", source_record_id: "lookup", timestamp_basis: "source_retrieval" }, ...overrides };
}
// React Query and auth are mocked above, so these calls expose their query/mutation configuration.
async function accounts() { return (platformAccountsHook("person") as unknown as { queryFn: () => Promise<Row[]> }).queryFn(); }
async function mapAccounts() { return (mapPlatformAccountsHook() as unknown as { mutationFn: (id: string) => Promise<{ mapped: number }> }).mutationFn("person"); }
async function events() { return (personaEventsHook("person") as unknown as { queryFn: () => Promise<Row[]> }).queryFn(); }
beforeEach(() => {
  state.rows = { personas: [{ id: "person", user_id: "owner" }], persona_events: [], platform_accounts: [], persona_identifiers: [{ persona_id: "person", user_id: "owner", identifier_type: "social_profile", identifier_value: profile.profileUrl, source: "live:GitHub:source", confidence_score: 1, created_at: "2026-11-04T10:00:00Z" }] };
  state.writes = []; setRecords(ledger());
});

describe("current reviewed platform and timeline boundaries", () => {
  it("does not admit a live identifier or matching profile URL without a current supported review", async () => {
    setRecords(ledger().slice(0, 1)); state.rows.platform_accounts = [accountRow(null)];
    expect(await accounts()).toEqual([]);
    setRecords(ledger()); const original = accountRow(); state.rows.platform_accounts = [original];
    expect((await accounts()).map(row => row.id)).toEqual(["account"]);
    state.rows.personas = [];
    expect(await accounts()).toEqual([]); expect(await mapAccounts()).toEqual({ mapped: 0 }); expect(await buildPersonaTimeline("owner", "person")).toEqual({ eventsCreated: 0 });
    expect(state.rows.platform_accounts).toEqual([original]); expect(state.rows.tool_results).toHaveLength(2);
  });
  it("does not map platform accounts from inputs or unreviewed lookups", async () => {
    setRecords(ledger().slice(0, 1));
    expect(await mapAccounts()).toEqual({ mapped: 0 }); expect(state.writes).toEqual([]);
  });
  it("binds a displayed platform account to its stable ID, profile and current review", async () => {
    const valid = accountRow();
    state.rows.platform_accounts = [valid, { ...valid, id: "legacy", metadata: null }, { ...valid, id: "wrong-id", account_identifier: "same-handle-only" }, { ...valid, id: "wrong-profile", profile_url: "https://github.com/other" }];
    expect((await accounts()).map(row => row.id)).toEqual(["account"]);
  });
  it("maps only reviewed stable accounts without fabricated confidence or independent verification", async () => {
    expect(await mapAccounts()).toEqual({ mapped: 1 });
    expect(state.writes[0].rows[0]).toMatchObject({ account_identifier: "github:123", profile_url: profile.profileUrl, confidence_score: 0, verified: false, metadata: { identity_evidence: { review_id: "review", lookup_result_id: "lookup" }, confidence_assessed: false } });
  });
  it("immediately hides and stops mapping a now-rejected account while preserving its saved row", async () => {
    const savedAccount = accountRow(); state.rows.platform_accounts = [savedAccount];
    const records = ledger(); const rejected = { ...records[1], id: "rejected", created_at: "2026-11-04T02:00:00Z", result_data: { ...(records[1].result_data as Row), decision: "rejected", reviewed_at: "2026-11-04T02:00:00Z" } };
    state.rows.tool_results = [...records, rejected].map(row => ({ ...row, user_id: "owner" }));
    expect(await accounts()).toEqual([]); expect(await mapAccounts()).toEqual({ mapped: 0 }); expect(state.rows.platform_accounts).toEqual([savedAccount]); expect(state.writes).toEqual([]);
  });
  it("does not turn supplied identifiers or unreviewed entities into timeline findings", async () => {
    setRecords(ledger().slice(0, 1)); state.rows.persona_identifiers[0].source = "input";
    expect(await buildPersonaTimeline("owner", "person")).toEqual({ eventsCreated: 0 }); expect(state.writes).toEqual([]);
  });
  it("uses the actual source retrieval timestamp rather than the local row creation time", async () => {
    setRecords(ledger(null));
    expect(await buildPersonaTimeline("owner", "person")).toEqual({ eventsCreated: 1 });
    expect(state.writes[0].rows[0]).toMatchObject({ event_type: "account_observed", event_timestamp: observedAt, source: profile.sourceUrl, metadata: { timestamp_basis: "source_retrieval", source_record_id: "lookup", identity_evidence: { review_id: "review" } } });
    expect(state.writes[0].rows[0].event_timestamp).not.toBe(state.rows.persona_identifiers[0].created_at);
  });
  it("includes account creation only when the retained provider record supplies its actual date", async () => {
    expect(await buildPersonaTimeline("owner", "person")).toEqual({ eventsCreated: 2 });
    expect(state.writes[0].rows.map(row => [row.event_type, row.event_timestamp])).toEqual([["account_created", createdAt], ["account_observed", observedAt]]);
    expect(state.writes[0].rows.every(row => (row.metadata as Row).identity_evidence)).toBe(true);
  });
  it("does not invent a creation date when the provider date is missing or after retrieval", async () => {
    setRecords(ledger("2027-01-01T00:00:00Z"));
    await buildPersonaTimeline("owner", "person");
    expect(state.writes.flatMap(write => write.rows).filter(row => row.event_type === "account_created")).toEqual([]);
  });
  it("hides old input, generated and arbitrary event rows without deleting them", async () => {
    const old = [eventRow({ id: "old-input", event_type: "input_recorded" }), eventRow({ id: "old-entity", event_type: "entity_created" }), eventRow({ id: "old-generated", event_type: "username_generated" })];
    state.rows.persona_events = old;
    expect(await events()).toEqual([]); expect(state.rows.persona_events).toEqual(old); expect(state.writes).toEqual([]);
  });
  it("rejects copied event metadata with a fabricated source time or stale review", async () => {
    const valid = eventRow();
    state.rows.persona_events = [valid, eventRow({ id: "fake-time", event_timestamp: "2026-11-04T10:00:00Z" }), eventRow({ id: "stale", metadata: { ...(valid.metadata as Row), identity_evidence: { ...((valid.metadata as Row).identity_evidence as Row), review_id: "old-review" } } }), eventRow({ id: "missing-source", metadata: { ...(valid.metadata as Row), identity_evidence: { ...((valid.metadata as Row).identity_evidence as Row), source_url: undefined } } }), eventRow({ id: "excluded", metadata: { ...(valid.metadata as Row), resolution_excluded: true } })];
    expect((await events()).map(row => row.id)).toEqual(["event"]);
  });
  it("deduplicates current source events but retains old rows when a new review changes the binding", async () => {
    await buildPersonaTimeline("owner", "person");
    const original = state.writes.flatMap(write => write.rows); state.rows.persona_events = original; state.writes = [];
    expect(await buildPersonaTimeline("owner", "person")).toEqual({ eventsCreated: 0 });
    const records = ledger(); const renewed = { ...records[1], id: "review-new", created_at: "2026-11-04T02:00:00Z", result_data: { ...(records[1].result_data as Row), reviewed_at: "2026-11-04T02:00:00Z" } };
    setRecords([...records, renewed]);
    expect(await buildPersonaTimeline("owner", "person")).toEqual({ eventsCreated: 2 });
    expect(state.rows.persona_events).toEqual(original); expect(state.writes.every(write => write.kind !== "delete")).toBe(true);
  });
});
