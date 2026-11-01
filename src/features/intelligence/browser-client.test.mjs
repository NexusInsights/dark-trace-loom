import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createBrowserClient, getVisitorTracking, captureFingerprint } from "./browser-client.js";

function fakeBrowser({ protocol = "https:", rejectCookie = false, rejectRemoval = false, failStorage = false } = {}) {
  const cookies = new Map([["unrelated", "preserved"]]);
  const stored = new Map();
  const writes = [];
  const browserDocument = {
    get cookie() { return [...cookies].map(([name, value]) => `${name}=${value}`).join("; "); },
    set cookie(value) {
      writes.push(value);
      const [pair] = value.split(";");
      const equals = pair.indexOf("=");
      const name = pair.slice(0, equals);
      if (value.includes("Max-Age=0")) {
        if (!rejectRemoval) cookies.delete(name);
      } else if (!rejectCookie) cookies.set(name, pair.slice(equals + 1));
    },
  };
  const browserWindow = {
    location: { protocol },
    crypto: { randomUUID },
    localStorage: {
      getItem(key) { if (failStorage) throw new Error("Blocked storage"); return stored.get(key) ?? null; },
      setItem(key, value) { if (failStorage) throw new Error("Blocked storage"); stored.set(key, value); },
      removeItem(key) { if (failStorage) throw new Error("Blocked storage"); stored.delete(key); },
    },
  };
  const loadCalls = [];
  const client = createBrowserClient({
    getWindow: () => browserWindow,
    getDocument: () => browserDocument,
    fingerprintLoader: async () => ({ default: { load: async (options) => {
      loadCalls.push(options);
      return { get: async () => ({ visitorId: "0123456789abcdef0123456789abcdef", confidence: { score: 0.6, comment: "Upgrade to Pro: https://vendor.example/upgrade", unknown: "discard me" }, version: "5.3.0" }) };
    } } }),
  });
  return { client, cookies, stored, writes, loadCalls, browserWindow };
}

test("SSR imports are safe and do not collect data", async () => {
  assert.deepEqual(getVisitorTracking(), { enabled: false, visitorId: null });
  await assert.rejects(captureFingerprint(), { code: "browser_unavailable" });
});

test("fingerprinting runs only when requested and disables vendor monitoring", async () => {
  const { client, loadCalls, cookies } = fakeBrowser();
  assert.deepEqual(loadCalls, []);
  const fingerprint = await client.captureFingerprint();
  assert.deepEqual(loadCalls, [{ monitoring: false }]);
  assert.equal(fingerprint.visitorId, "0123456789abcdef0123456789abcdef");
  assert.equal(fingerprint.scope, "current_browser");
  assert.deepEqual(fingerprint.confidence, { score: 0.6 });
  assert.equal(fingerprint.version, "5.3.0");
  assert.doesNotMatch(JSON.stringify(fingerprint), /Upgrade|vendor\.example|discard me/);
  assert.ok(Number.isFinite(Date.parse(fingerprint.capturedAt)));
  assert.equal(cookies.size, 1, "Fingerprint capture does not implicitly enable cookie tracking");
});

test("tracking IDs persist per browser, are unique, and use scoped secure cookies", () => {
  const first = fakeBrowser();
  const second = fakeBrowser();
  assert.deepEqual(first.client.getVisitorTracking("osintshadow_visitor"), { enabled: false, visitorId: null });
  const enabled = first.client.enableVisitorTracking("osintshadow_visitor");
  assert.equal(enabled.enabled, true);
  assert.match(enabled.visitorId, /^[0-9a-f-]{36}$/i);
  assert.deepEqual(first.client.enableVisitorTracking("osintshadow_visitor"), enabled);
  assert.deepEqual(first.client.getVisitorTracking("osintshadow_visitor"), enabled);
  assert.notEqual(second.client.enableVisitorTracking("osintshadow_visitor").visitorId, enabled.visitorId);
  assert.match(first.writes[0], /Path=\/; Max-Age=31536000; SameSite=Lax; Secure$/);
  assert.equal(first.cookies.get("unrelated"), "preserved");
  assert.deepEqual(first.loadCalls, [], "Cookie consent does not collect fingerprints");
  assert.deepEqual(first.client.disableVisitorTracking("osintshadow_visitor"), { enabled: false, visitorId: null });
  assert.equal(first.cookies.has("osintshadow_visitor"), false);
  assert.equal(first.stored.has("osintshadow_visitor:enabled"), false);
  assert.equal(first.cookies.get("unrelated"), "preserved");
  assert.notEqual(first.client.enableVisitorTracking("osintshadow_visitor").visitorId, enabled.visitorId);
});

test("local HTTP cookie works without Secure and invalid namespaces cannot inject attributes", () => {
  const { client, writes } = fakeBrowser({ protocol: "http:" });
  client.enableVisitorTracking();
  assert.doesNotMatch(writes[0], /Secure/);
  assert.throws(() => client.enableVisitorTracking("visitor; Domain=example.com"), { code: "invalid_namespace" });
});

test("silent cookie rejection is detected and consent is rolled back", () => {
  const { client, stored, cookies } = fakeBrowser({ rejectCookie: true });
  assert.throws(() => client.enableVisitorTracking(), { code: "tracking_write_failed" });
  assert.equal(stored.size, 0);
  assert.equal(cookies.has("intelligence_visitor"), false);
});

test("storage failures are reported and do not start tracking", () => {
  const { client, cookies } = fakeBrowser({ failStorage: true });
  assert.throws(() => client.enableVisitorTracking(), { code: "tracking_storage_unavailable" });
  assert.equal(cookies.size, 1);
});

test("revocation reports a browser refusing to clear its cookie while removing consent", () => {
  const { client, stored } = fakeBrowser({ rejectRemoval: true });
  client.enableVisitorTracking();
  assert.throws(() => client.disableVisitorTracking(), { code: "tracking_clear_failed" });
  assert.equal(stored.size, 0);
});

test("fingerprint dependency failures use an actionable typed error", async () => {
  const client = createBrowserClient({
    getWindow: () => ({}), getDocument: () => ({}),
    fingerprintLoader: async () => { throw new Error("Load failed"); },
  });
  await assert.rejects(client.captureFingerprint(), { code: "fingerprint_collection_failed" });
});

test("unresponsive fingerprint dependencies time out instead of leaving the action pending", async () => {
  const client = createBrowserClient({
    getWindow: () => ({}), getDocument: () => ({}),
    fingerprintLoader: () => new Promise(() => {}), fingerprintTimeoutMs: 10,
  });
  await assert.rejects(client.captureFingerprint(), { code: "fingerprint_collection_timeout" });
});

test("invalid fingerprint confidence scores are omitted without exposing vendor fields", async () => {
  for (const score of [NaN, Infinity, -0.1, 1.1, "0.6"]) {
    const client = createBrowserClient({
      getWindow: () => ({}), getDocument: () => ({}),
      fingerprintLoader: async () => ({ load: async () => ({ get: async () => ({
        visitorId: "0123456789abcdef0123456789abcdef", confidence: { score, comment: "vendor upsell" }, version: "5.3.0",
      }) }) }),
    });
    const result = await client.captureFingerprint();
    assert.equal("confidence" in result, false);
    assert.equal(result.version, "5.3.0");
  }
});
