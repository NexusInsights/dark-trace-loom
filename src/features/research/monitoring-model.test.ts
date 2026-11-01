import { afterEach, describe, expect, it, vi } from "vitest";
import { webcrypto, createHash } from "node:crypto";
import { authorizedSource, parseMonitorHistory, parseMonitorJobs, snapshotDiff, verifiedSnapshots, verifySnapshot, type Snapshot } from "./monitoring-model";

afterEach(() => vi.unstubAllGlobals());
const snapshot: Snapshot = { source: "https://approved.example/feed", fetched_at: "2026-11-01T00:00:00Z", data: { items: ["Alpha", "Beta"] } };
const digest = createHash("sha256").update('{"items":["Alpha","Beta"]}').digest("hex");
describe("source evidence and coverage boundaries", () => {
  it("independently verifies a real SHA-256 receipt and detects modified evidence", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const record = { id: "baseline", observed_at: 1000, content_hash: digest, snapshot };
    expect(await verifySnapshot("rss", record)).toBe(true);
    expect(await verifySnapshot("rss", { ...record, snapshot: { ...snapshot, data: { items: ["Tampered"] } } })).toBe(false);
  });
  it("ignores ordering and retrieval-time noise while exposing actual changed field values", () => {
    expect(snapshotDiff("rss", snapshot, { ...snapshot, fetched_at: "2026-11-02", data: { items: ["Beta", "Alpha"] } })).toEqual([]);
    expect(snapshotDiff("rss", snapshot, { ...snapshot, data: { items: ["Alpha", "Gamma"] } })).toEqual([{ field: "items", before: '["Alpha","Beta"]', after: '["Alpha","Gamma"]' }]);
  });
  it("keeps failed attempts separate and preserves the retained successful snapshot outside the history window", () => {
    const data = parseMonitorHistory({ history: [{ id: "failure", state: "failed", observed_at: 2000, failure_receipt: { coverage_state: "blocked" } }], latest_verified: { observed_at: 1000, content_hash: digest, snapshot } });
    expect(verifiedSnapshots(data)).toEqual([{ id: "latest-verified", observed_at: 1000, content_hash: digest, snapshot }]);
    expect(data.history[0].observed_at).toBe(2000);
  });
  it("never expands the approved host list or accepts embedded credentials", () => {
    const status = { configured: true, authorized_page_hosts: ["approved.example"] };
    expect(authorizedSource("https://approved.example/feed", status)).toBe("https://approved.example/feed");
    expect(() => authorizedSource("https://elsewhere.example/feed", status)).toThrow("approved source list");
    expect(() => authorizedSource("https://approved.example/feed?token=private", status)).toThrow("credential parameters");
    expect(() => authorizedSource("https://user:password@approved.example/feed", status)).toThrow("embedded credentials");
  });
  it("rejects malformed and unknown coverage rather than treating it as no match", () => {
    expect(() => parseMonitorJobs({ jobs: null })).toThrow("invalid job list");
    expect(() => parseMonitorJobs({ jobs: [{ id: "11111111-1111-4111-8111-111111111111", kind: "rss", label: "Fixture", enabled: true, interval_seconds: 300, params: {}, coverage: { state: "success_maybe", last_attempt: 1, last_success: 1, stale: false } }] })).toThrow("invalid source coverage");
  });
});
