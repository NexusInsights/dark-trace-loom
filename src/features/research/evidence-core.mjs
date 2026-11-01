/** Independent evidence domain model. Web APIs only; no network, storage, or credentials. */
export const EVIDENCE_SCHEMA = 'evidence-ledger/v1';
export const ENTITY_TYPES = Object.freeze(['Person', 'Organization', 'Company', 'Domain', 'IPAddress', 'EmailAddress', 'URL', 'Document', 'Event', 'Account', 'Wallet', 'Location', 'File', 'Other']);
export const LIMITS = Object.freeze({ jsonBytes: 4 * 1024 * 1024, sources: 1000, entities: 2000, observations: 5000, claims: 3000, reviews: 5000, artifacts: 200, audit: 10000, fileBytes: 16 * 1024 * 1024, bundleBytes: 32 * 1024 * 1024, files: 100 });
const encoder = new TextEncoder();
const forbiddenKeys = new Set(['__proto__', 'constructor', 'prototype']);
const listFields = ['sources', 'entities', 'observations', 'claims', 'reviews', 'artifacts', 'audit'];
const own = (object, key) => Object.hasOwn(object, key);

export class EvidenceError extends Error {
  constructor(code, message) { super(message); this.name = 'EvidenceError'; this.code = code; }
}
export function fail(code, message) { throw new EvidenceError(code, message); }

/** Reject accessors, exotic prototypes, cycles and prototype-pollution keys before inspecting values. */
export function assertSafeData(value, { maxBytes = LIMITS.jsonBytes, maxDepth = 16, maxNodes = 50000, maxString = 512000 } = {}) {
  let nodes = 0;
  const seen = new WeakSet();
  function visit(item, depth) {
    if (++nodes > maxNodes || depth > maxDepth) fail('IMPORT_LIMIT', 'Input nesting or item count exceeds the limit.');
    if (item === null || typeof item === 'boolean') return;
    if (typeof item === 'string') { if (item.length > maxString) fail('IMPORT_LIMIT', 'Input text exceeds the limit.'); if (item.isWellFormed?.() === false) fail('INVALID_DATA', 'Text must contain valid Unicode.'); return; }
    if (typeof item === 'number') { if (!Number.isFinite(item)) fail('INVALID_DATA', 'Numbers must be finite.'); return; }
    if (typeof item !== 'object') fail('INVALID_DATA', 'Only JSON data is accepted.');
    if (seen.has(item)) fail('INVALID_DATA', 'Cyclic or shared object references are not accepted.');
    seen.add(item);
    const proto = Object.getPrototypeOf(item);
    if (!Array.isArray(item) && proto !== Object.prototype && proto !== null) fail('INVALID_DATA', 'Only plain JSON objects are accepted.');
    for (const key of Reflect.ownKeys(item)) {
      if (typeof key !== 'string' || forbiddenKeys.has(key)) fail('UNSAFE_KEY', 'Unsafe object keys are not accepted.');
      if (key.length > 1024 || /[\u0000-\u001f\u007f]/.test(key) || key.isWellFormed?.() === false) fail('IMPORT_LIMIT', 'Object key exceeds the permitted format.');
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (!descriptor || descriptor.get || descriptor.set) fail('INVALID_DATA', 'Object accessors are not accepted.');
      if (Array.isArray(item) && key === 'length') continue;
      if (!descriptor.enumerable) fail('INVALID_DATA', 'Hidden object fields are not accepted.');
      if (Array.isArray(item) && !/^(0|[1-9]\d*)$/.test(key)) fail('INVALID_DATA', 'Array metadata is not accepted.');
      visit(descriptor.value, depth + 1);
    }
    if (Array.isArray(item) && (item.length > 10000 || Object.keys(item).length !== item.length)) fail('IMPORT_LIMIT', 'Sparse or oversized arrays are not accepted.');
    seen.delete(item);
  }
  visit(value, 0);
  if (encoder.encode(JSON.stringify(value)).byteLength > maxBytes) fail('IMPORT_LIMIT', 'Input exceeds the byte limit.');
  return value;
}
export function parseEvidenceJSON(input, options = {}) {
  if (typeof input !== 'string') return assertSafeData(input, options);
  if (encoder.encode(input).byteLength > (options.maxBytes ?? LIMITS.jsonBytes)) fail('IMPORT_LIMIT', 'JSON exceeds the byte limit.');
  let parsed;
  try { parsed = JSON.parse(input); } catch { fail('INVALID_JSON', 'Input is not valid JSON.'); }
  return assertSafeData(parsed, options);
}
export function canonicalJSON(value) {
  assertSafeData(value);
  const stable = (item) => item === null || typeof item !== 'object' ? item : Array.isArray(item) ? item.map(stable) : Object.fromEntries(Object.keys(item).sort().map((key) => [key, stable(item[key])]));
  return JSON.stringify(stable(value));
}
export function safeJSONStringify(value, space = 2) {
  assertSafeData(value);
  return JSON.stringify(value, null, space).replace(/[<>&\u2028\u2029]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
}
function cryptoAPI() {
  if (!globalThis.crypto?.subtle) fail('CRYPTO_UNAVAILABLE', 'Web Crypto is required for evidence digests.');
  return globalThis.crypto;
}
export async function sha256(input) {
  const bytes = toBytes(input);
  const result = await cryptoAPI().subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(result)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
export function toBytes(input, maxBytes = LIMITS.fileBytes) {
  let bytes;
  if (typeof input === 'string') bytes = encoder.encode(input);
  else if (ArrayBuffer.isView(input)) {
    // instanceof fails for legitimate FileReader/iframe values from another realm.
    // Intrinsic getters check the internal brand without invoking caller accessors.
    const prototype = Object.getPrototypeOf(Uint8Array.prototype);
    const get = (key) => Object.getOwnPropertyDescriptor(prototype, key).get.call(input);
    if (get(Symbol.toStringTag) !== 'Uint8Array') fail('INVALID_FILE', 'File byte views must be Uint8Array.');
    const length = get('byteLength');
    if (length > maxBytes) fail('IMPORT_LIMIT', 'File exceeds the byte limit.');
    bytes = new Uint8Array(get('buffer'), get('byteOffset'), length);
  } else {
    try {
      const length = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get.call(input);
      bytes = new Uint8Array(input, 0, length);
    } catch { fail('INVALID_FILE', 'File content must be text, Uint8Array, or ArrayBuffer.'); }
  }
  if (bytes.byteLength > maxBytes) fail('IMPORT_LIMIT', 'File exceeds the byte limit.');
  // A private snapshot also prevents mutation/detachment during an async digest.
  return new Uint8Array(bytes);
}
function object(value, allowed, required = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_SCHEMA', 'A JSON object is required.');
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('INVALID_SCHEMA', 'A plain object is required.');
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || forbiddenKeys.has(key) || descriptor?.get || descriptor?.set) fail('INVALID_SCHEMA', 'Unsafe fields or object accessors are not accepted.');
  }
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail('INVALID_SCHEMA', 'An unsupported field is present.');
  for (const key of required) if (!own(value, key)) fail('INVALID_SCHEMA', `Required field missing: ${key}.`);
  return value;
}
function text(value, name, max = 2000, { empty = false } = {}) {
  if (typeof value !== 'string' || (!empty && !value.trim()) || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) fail('INVALID_SCHEMA', `${name} must be bounded text without control characters.`);
  return value;
}
function id(value, name = 'ID') { if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value)) fail('INVALID_ID', `${name} is invalid.`); return value; }
function values(value, name, max) { if (!Array.isArray(value) || value.length > max) fail('IMPORT_LIMIT', `${name} must be an array within the limit.`); return value; }
function enumValue(value, choices, name) { if (!choices.includes(value)) fail('INVALID_SCHEMA', `${name} is not supported.`); return value; }
function hash(value) { if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) fail('INVALID_HASH', 'A lower-case SHA-256 digest is required.'); return value; }
function scalar(value) {
  if (typeof value === 'string') return text(value, 'Value', 32000, { empty: true });
  if (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return value;
  fail('INVALID_SCHEMA', 'Observation and claim values must be JSON scalars.');
}
export function safeSourceURL(value) {
  if (value === undefined || value === null || value === '') return null;
  text(value, 'Source URL', 2048);
  let url;
  try { url = new URL(value); } catch { fail('INVALID_URL', 'A valid HTTP(S) source URL is required.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) fail('INVALID_URL', 'Source URLs must use HTTP(S) without credentials.');
  return url.href;
}
export function normalizeEventTime(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') fail('INVALID_DATE', 'Dates must be ISO date or zoned timestamp strings.');
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d))?$/.exec(value);
  if (!match) fail('INVALID_DATE', 'Use YYYY-MM-DD or an ISO timestamp with a timezone.');
  const datePart = `${match[1]}-${match[2]}-${match[3]}`;
  const day = new Date(`${datePart}T00:00:00.000Z`);
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== datePart || !Number.isFinite(Date.parse(value))) fail('INVALID_DATE', 'The date does not exist.');
  return { value: new Date(value.length === 10 ? `${value}T00:00:00.000Z` : value).toISOString(), precision: value.length === 10 ? 'day' : 'timestamp' };
}
function timestamp(value, name = 'Timestamp') {
  const date = normalizeEventTime(value);
  if (!date || date.precision !== 'timestamp') fail('INVALID_DATE', `${name} requires a zoned ISO timestamp.`);
  return date.value;
}
const copy = (value) => JSON.parse(JSON.stringify(value));
const same = (left, right) => canonicalJSON(left) === canonicalJSON(right);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const sorted = (rows) => [...rows].sort((a, b) => compare(a.id, b.id));
function refs(input, available, name, { min = 0 } = {}) {
  const result = values(input ?? [], name, 500).map((item) => id(item));
  if (new Set(result).size !== result.length || result.length < min) fail('INVALID_REFERENCE', `${name} must contain distinct references.`);
  for (const ref of result) if (!available.has(ref)) fail('INVALID_REFERENCE', `${name} references an absent record.`);
  return result.sort();
}
function normalizeSource(value) {
  object(value, ['id', 'label', 'url', 'provider', 'publisher', 'independenceGroup', 'independence'], ['id', 'label']);
  const independence = enumValue(value.independence ?? 'unknown', ['unknown', 'independent', 'shared_origin'], 'Source independence');
  const group = value.independenceGroup == null ? null : text(value.independenceGroup, 'Source group', 160);
  if (independence !== 'unknown' && !group) fail('INVALID_SCHEMA', 'Assessed sources require an explicit origin group.');
  return { id: id(value.id), label: text(value.label, 'Source label', 500), url: safeSourceURL(value.url), provider: value.provider == null ? null : text(value.provider, 'Provider', 160), publisher: value.publisher == null ? null : text(value.publisher, 'Publisher', 200), independenceGroup: group, independence };
}
function normalizeEntity(value) {
  object(value, ['id', 'type', 'label', 'identifiers'], ['id', 'type', 'label']);
  const identifiers = values(value.identifiers ?? [], 'Entity identifiers', 30).map((identifier) => {
    object(identifier, ['type', 'value'], ['type', 'value']);
    return { type: text(identifier.type, 'Identifier type', 80), value: text(identifier.value, 'Identifier value', 500) };
  }).sort((a, b) => compare(canonicalJSON(a), canonicalJSON(b)));
  return { id: id(value.id), type: enumValue(value.type, ENTITY_TYPES, 'Entity type'), label: text(value.label, 'Entity label', 500), identifiers };
}
function baseSnapshot(ledger) { return Object.fromEntries(Object.entries(ledger).filter(([key]) => key !== 'audit')); }
function assertLedger(ledger) {
  assertSafeData(ledger);
  object(ledger, ['schema', 'schemaVersion', 'caseId', 'title', 'createdAt', ...listFields], ['schema', 'schemaVersion', 'caseId', 'title', 'createdAt', ...listFields]);
  if (ledger.schema !== EVIDENCE_SCHEMA || ledger.schemaVersion !== 1) fail('INVALID_SCHEMA', 'Unsupported evidence ledger version.');
  id(ledger.caseId, 'Case ID'); text(ledger.title, 'Case title', 500); timestamp(ledger.createdAt);
  for (const field of listFields) {
    values(ledger[field], field, LIMITS[field]);
    const seen = new Set();
    for (const row of ledger[field]) { if (!row || typeof row !== 'object') fail('INVALID_SCHEMA', 'Record must be an object.'); id(row.id); if (seen.has(row.id)) fail('CONFLICT', 'Duplicate record IDs are not accepted.'); seen.add(row.id); }
  }
  for (const source of ledger.sources) if (!same(source, normalizeSource(source))) fail('INVALID_SCHEMA', 'Source is not normalized.');
  for (const entity of ledger.entities) if (!same(entity, normalizeEntity(entity))) fail('INVALID_SCHEMA', 'Entity is not normalized.');
  const sourceIds = new Set(ledger.sources.map((item) => item.id));
  const entityIds = new Set(ledger.entities.map((item) => item.id));
  const observationIds = new Set(ledger.observations.map((item) => item.id));
  const artifactIds = new Set(ledger.artifacts.map((item) => item.id));
  for (const observation of ledger.observations) {
    object(observation, ['id', 'sourceId', 'entityId', 'property', 'value', 'eventTime', 'capturedAt', 'artifactId'], ['id', 'sourceId', 'entityId', 'property', 'value', 'eventTime', 'capturedAt', 'artifactId']);
    if (!sourceIds.has(observation.sourceId) || !entityIds.has(observation.entityId) || (observation.artifactId !== null && !artifactIds.has(observation.artifactId))) fail('INVALID_REFERENCE', 'Observation refers to an absent record.');
    text(observation.property, 'Property', 160); scalar(observation.value); timestamp(observation.capturedAt);
    if (observation.eventTime !== null) {
      object(observation.eventTime, ['value', 'precision'], ['value', 'precision']);
      timestamp(observation.eventTime.value); enumValue(observation.eventTime.precision, ['day', 'timestamp'], 'Date precision');
      if (observation.eventTime.precision === 'day' && !observation.eventTime.value.endsWith('T00:00:00.000Z')) fail('INVALID_DATE', 'Date-only values must retain their normalized day precision.');
    }
  }
  for (const claim of ledger.claims) {
    object(claim, ['id', 'subjectId', 'predicate', 'objectId', 'value', 'evidenceIds', 'counterEvidenceIds', 'status'], ['id', 'subjectId', 'predicate', 'objectId', 'value', 'evidenceIds', 'counterEvidenceIds', 'status']);
    if (!entityIds.has(claim.subjectId) || (claim.objectId !== null && !entityIds.has(claim.objectId))) fail('INVALID_REFERENCE', 'Claim refers to an absent entity.');
    text(claim.predicate, 'Claim predicate', 160); scalar(claim.value); refs(claim.evidenceIds, observationIds, 'Claim evidence', { min: 1 }); refs(claim.counterEvidenceIds, observationIds, 'Counterevidence');
    enumValue(claim.status, ['unreviewed', 'accepted', 'rejected', 'needs_review'], 'Claim status');
  }
  for (const review of ledger.reviews) {
    object(review, ['id', 'kind', 'claimId', 'leftId', 'rightId', 'decision', 'reason', 'evidenceIds', 'counterEvidenceIds', 'actor', 'at'], ['id', 'kind', 'decision', 'reason', 'evidenceIds', 'counterEvidenceIds', 'actor', 'at']);
    enumValue(review.kind, ['claim', 'match'], 'Review kind'); text(review.reason, 'Review reason', 2000); text(review.actor, 'Reviewer', 160); timestamp(review.at);
    refs(review.evidenceIds, observationIds, 'Review evidence'); refs(review.counterEvidenceIds, observationIds, 'Review counterevidence');
    if (review.kind === 'claim') {
      if (!ledger.claims.some((claim) => claim.id === review.claimId)) fail('INVALID_REFERENCE', 'Reviewed claim is absent.');
      enumValue(review.decision, ['accepted', 'rejected', 'needs_review'], 'Claim decision');
    } else {
      if (!entityIds.has(review.leftId) || !entityIds.has(review.rightId) || review.leftId === review.rightId) fail('INVALID_REFERENCE', 'Match endpoints are invalid.');
      enumValue(review.decision, ['accepted', 'rejected', 'revoked'], 'Match decision');
    }
  }
  for (const artifact of ledger.artifacts) { object(artifact, ['id', 'manifest'], ['id', 'manifest']); assertManifest(artifact.manifest); }
  return ledger;
}
export function validateLedger(ledger) { assertLedger(ledger); return true; }
export function createLedger({ caseId, title = 'Investigation evidence', createdAt = new Date().toISOString() } = {}) {
  return { schema: EVIDENCE_SCHEMA, schemaVersion: 1, caseId: id(caseId, 'Case ID'), title: text(title, 'Case title', 500), createdAt: timestamp(createdAt), sources: [], entities: [], observations: [], claims: [], reviews: [], artifacts: [], audit: [] };
}
async function seal(ledger, action, details, context) {
  const actor = text(context?.actor, 'Actor', 160);
  const at = timestamp(context?.at ?? new Date().toISOString());
  const last = ledger.audit.at(-1);
  if (last && at < last.at) fail('INVALID_DATE', 'Audit time cannot precede the previous mutation.');
  const sequence = ledger.audit.length + 1;
  const entry = { id: `audit-${sequence}`, sequence, action, actor, at, details, snapshotDigest: await sha256(canonicalJSON(baseSnapshot(ledger))), previousDigest: last?.digest ?? null };
  entry.digest = await sha256(canonicalJSON(entry));
  ledger.audit.push(entry);
  assertLedger(ledger);
  return ledger;
}
export async function verifyLedger(ledger, { expectedHead = null } = {}) {
  assertLedger(ledger);
  let previous = null;
  let valid = true;
  for (const [index, entry] of ledger.audit.entries()) {
    object(entry, ['id', 'sequence', 'action', 'actor', 'at', 'details', 'snapshotDigest', 'previousDigest', 'digest'], ['id', 'sequence', 'action', 'actor', 'at', 'details', 'snapshotDigest', 'previousDigest', 'digest']);
    hash(entry.digest); hash(entry.snapshotDigest); text(entry.action, 'Audit action', 80); text(entry.actor, 'Audit actor', 160); timestamp(entry.at);
    const { digest, ...body } = entry;
    if (entry.sequence !== index + 1 || entry.id !== `audit-${index + 1}` || entry.previousDigest !== previous || digest !== await sha256(canonicalJSON(body)) || (index > 0 && entry.at < ledger.audit[index - 1].at)) valid = false;
    previous = digest;
  }
  const contentDigest = await sha256(canonicalJSON(baseSnapshot(ledger)));
  if (ledger.audit.length ? ledger.audit.at(-1).snapshotDigest !== contentDigest : listFields.filter((field) => field !== 'audit').some((field) => ledger[field].length)) valid = false;
  if (expectedHead !== null) { hash(expectedHead); if (previous !== expectedHead) valid = false; }
  for (const artifact of ledger.artifacts) if (!await verifyManifestDigest(artifact.manifest)) valid = false;
  return { ok: valid, head: previous, contentDigest, checkpointChecked: expectedHead !== null, authenticity: 'not_established', note: 'Digests detect changes against a retained checkpoint; they do not prove source authenticity or resist an attacker who can rewrite all digests.' };
}
async function verifiedCopy(ledger) {
  if (!(await verifyLedger(ledger)).ok) fail('INTEGRITY_CHECK_FAILED', 'The ledger digest or audit chain failed verification.');
  return copy(ledger);
}
async function derivedId(prefix, data) { return `${prefix}-${(await sha256(canonicalJSON(data))).slice(0, 32)}`; }
function insertRecord(rows, record, code = 'CONFLICT') {
  const existing = rows.find((row) => row.id === record.id);
  if (existing) { if (!same(existing, record)) fail(code, 'An existing record ID contains different data. Preserve conflicts as separate observations.'); return false; }
  rows.push(record); return true;
}

/** Consume normalized source records. This never discovers people, infers probabilities, or auto-merges identities. */
export async function ingestEvidence(ledger, input, context) {
  assertSafeData(input, { maxBytes: 1024 * 1024 });
  object(input, ['source', 'entities', 'observations', 'claims'], ['source']);
  const next = await verifiedCopy(ledger);
  const source = normalizeSource(input.source);
  let changed = insertRecord(next.sources, source, 'SOURCE_CONFLICT');
  for (const entity of values(input.entities ?? [], 'Entities', 500)) changed = insertRecord(next.entities, normalizeEntity(entity), 'ENTITY_CONFLICT') || changed;
  const entityIds = new Set(next.entities.map((entity) => entity.id));
  const artifactIds = new Set(next.artifacts.map((artifact) => artifact.id));
  const importedIds = [];
  for (const raw of values(input.observations ?? [], 'Observations', 1000)) {
    object(raw, ['id', 'entityId', 'property', 'value', 'eventTime', 'capturedAt', 'artifactId'], ['entityId', 'property', 'value']);
    if (!entityIds.has(raw.entityId)) fail('INVALID_REFERENCE', 'Observation entity is absent.');
    const artifactId = raw.artifactId == null ? null : id(raw.artifactId);
    if (artifactId !== null && !artifactIds.has(artifactId)) fail('INVALID_REFERENCE', 'Observation artifact is absent.');
    const content = { sourceId: source.id, entityId: id(raw.entityId), property: text(raw.property, 'Property', 160), value: scalar(raw.value), eventTime: normalizeEventTime(raw.eventTime), artifactId };
    const observation = { id: raw.id == null ? await derivedId('obs', content) : id(raw.id), ...content, capturedAt: timestamp(raw.capturedAt ?? context?.at ?? new Date().toISOString()) };
    const existing = next.observations.find((row) => row.id === observation.id);
    if (existing) {
      const { capturedAt: ignoredOld, ...oldContent } = existing;
      const { capturedAt: ignoredNew, ...newContent } = observation;
      if (!same(oldContent, newContent)) fail('OBSERVATION_CONFLICT', 'An observation ID cannot overwrite different evidence.');
    } else { next.observations.push(observation); importedIds.push(observation.id); changed = true; }
  }
  const observationIds = new Set(next.observations.map((row) => row.id));
  for (const raw of values(input.claims ?? [], 'Claims', 500)) {
    object(raw, ['id', 'subjectId', 'predicate', 'objectId', 'value', 'evidenceIds', 'counterEvidenceIds'], ['subjectId', 'predicate', 'evidenceIds']);
    const hasObject = raw.objectId != null;
    if (hasObject === own(raw, 'value')) fail('INVALID_SCHEMA', 'A claim requires either an object entity or a scalar value.');
    if (!entityIds.has(raw.subjectId) || (hasObject && !entityIds.has(raw.objectId))) fail('INVALID_REFERENCE', 'Claim endpoint is absent.');
    const content = { subjectId: id(raw.subjectId), predicate: text(raw.predicate, 'Predicate', 160), objectId: hasObject ? id(raw.objectId) : null, value: hasObject ? null : scalar(raw.value), evidenceIds: refs(raw.evidenceIds, observationIds, 'Claim evidence', { min: 1 }), counterEvidenceIds: refs(raw.counterEvidenceIds, observationIds, 'Counterevidence') };
    if (content.evidenceIds.some((ref) => content.counterEvidenceIds.includes(ref))) fail('INVALID_REFERENCE', 'Supporting evidence and counterevidence must be distinct.');
    const claim = { id: raw.id == null ? await derivedId('claim', content) : id(raw.id), ...content, status: 'unreviewed' };
    const existing = next.claims.find((row) => row.id === claim.id);
    if (existing) { const { status, ...old } = existing; const { status: ignored, ...fresh } = claim; if (!same(old, fresh)) fail('CLAIM_CONFLICT', 'A claim ID cannot overwrite another assertion.'); }
    else { next.claims.push(claim); changed = true; }
  }
  for (const field of ['sources', 'entities', 'observations', 'claims']) next[field] = sorted(next[field]);
  return changed ? seal(next, 'evidence.imported', { sourceId: source.id, observationIds: importedIds.sort() }, context) : next;
}
export async function reviewClaim(ledger, claimId, options) {
  assertSafeData(options);
  object(options, ['decision', 'reason', 'counterEvidenceIds', 'actor', 'at'], ['decision', 'reason', 'actor']);
  const next = await verifiedCopy(ledger);
  const claim = next.claims.find((item) => item.id === id(claimId));
  if (!claim) fail('NOT_FOUND', 'Claim was not found.');
  const decision = enumValue(options.decision, ['accepted', 'rejected', 'needs_review'], 'Decision');
  const reason = text(options.reason, 'Review reason', 2000);
  if (reason.trim().length < 3) fail('INVALID_SCHEMA', 'A meaningful review reason is required.');
  const counterEvidenceIds = refs(options.counterEvidenceIds ?? claim.counterEvidenceIds, new Set(next.observations.map((row) => row.id)), 'Counterevidence');
  if (claim.evidenceIds.some((ref) => counterEvidenceIds.includes(ref))) fail('INVALID_REFERENCE', 'Supporting evidence cannot also be counterevidence.');
  claim.status = decision; claim.counterEvidenceIds = counterEvidenceIds;
  const review = { id: `review-${next.reviews.length + 1}`, kind: 'claim', claimId, decision, reason, evidenceIds: [...claim.evidenceIds], counterEvidenceIds, actor: text(options.actor, 'Actor', 160), at: timestamp(options.at ?? new Date().toISOString()) };
  next.reviews.push(review);
  return seal(next, 'claim.reviewed', { reviewId: review.id, claimId, decision }, options);
}
export async function reviewMatch(ledger, options) {
  assertSafeData(options);
  object(options, ['leftId', 'rightId', 'decision', 'reason', 'evidenceIds', 'counterEvidenceIds', 'actor', 'at'], ['leftId', 'rightId', 'decision', 'reason', 'evidenceIds', 'actor']);
  const next = await verifiedCopy(ledger);
  const [leftId, rightId] = [id(options.leftId), id(options.rightId)].sort();
  if (leftId === rightId || !next.entities.some((row) => row.id === leftId) || !next.entities.some((row) => row.id === rightId)) fail('INVALID_REFERENCE', 'Match endpoints must be two existing entities.');
  const left = next.entities.find((row) => row.id === leftId); const right = next.entities.find((row) => row.id === rightId);
  if (left.type !== right.type) fail('INVALID_MATCH', 'Identity matches require entities of the same type.');
  const decision = enumValue(options.decision, ['accepted', 'rejected', 'revoked'], 'Match decision');
  const prior = next.reviews.findLast((row) => row.kind === 'match' && row.leftId === leftId && row.rightId === rightId);
  if (decision === 'revoked' && prior?.decision !== 'accepted') fail('INVALID_REVIEW_TRANSITION', 'Only a currently accepted match can be revoked.');
  const reason = text(options.reason, 'Review reason', 2000);
  if (reason.trim().length < 3) fail('INVALID_SCHEMA', 'A meaningful review reason is required.');
  const available = new Set(next.observations.map((row) => row.id));
  const evidenceIds = refs(options.evidenceIds, available, 'Match evidence', { min: decision === 'accepted' ? 1 : 0 });
  const counterEvidenceIds = refs(options.counterEvidenceIds, available, 'Counterevidence');
  if (evidenceIds.some((ref) => counterEvidenceIds.includes(ref))) fail('INVALID_REFERENCE', 'Supporting evidence and counterevidence must be distinct.');
  const review = { id: `review-${next.reviews.length + 1}`, kind: 'match', leftId, rightId, decision, reason, evidenceIds, counterEvidenceIds, actor: text(options.actor, 'Actor', 160), at: timestamp(options.at ?? new Date().toISOString()) };
  next.reviews.push(review);
  return seal(next, 'match.reviewed', { reviewId: review.id, leftId, rightId, decision }, options);
}
export function activeMatches(ledger) {
  assertLedger(ledger);
  const latest = new Map();
  for (const review of ledger.reviews) if (review.kind === 'match') latest.set(`${review.leftId}|${review.rightId}`, review);
  return [...latest.values()].filter((review) => review.decision === 'accepted').sort((a, b) => compare(a.id, b.id));
}
export function evidenceSummary(ledger, claimId) {
  assertLedger(ledger);
  const claim = ledger.claims.find((row) => row.id === claimId);
  if (!claim) fail('NOT_FOUND', 'Claim was not found.');
  const supporting = claim.evidenceIds.map((ref) => ledger.observations.find((row) => row.id === ref));
  const counterevidence = claim.counterEvidenceIds.map((ref) => ledger.observations.find((row) => row.id === ref));
  const sourceIds = new Set(supporting.map((row) => row.sourceId));
  const sources = ledger.sources.filter((row) => sourceIds.has(row.id));
  return { claim: copy(claim), supporting: copy(supporting), counterevidence: copy(counterevidence), sources: copy(sources), sourceCount: sources.length, declaredIndependentGroups: [...new Set(sources.filter((row) => row.independence === 'independent').map((row) => row.independenceGroup))].sort(), unknownSources: sources.filter((row) => row.independence === 'unknown').map((row) => row.id), independenceAssessment: 'analyst_declared_not_verified' };
}
export function findConflicts(ledger) {
  assertLedger(ledger);
  const groups = new Map();
  for (const observation of ledger.observations) {
    const key = `${observation.entityId}|${observation.property}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(observation);
  }
  return [...groups.values()].filter((rows) => new Set(rows.filter((row) => row.value !== null && !(typeof row.value === 'string' && !row.value.trim())).map((row) => canonicalJSON(row.value))).size > 1).map((rows) => ({ entityId: rows[0].entityId, property: rows[0].property, observations: copy(sorted(rows)), note: 'Different assertions may reflect conflict or change over time; no value was overwritten.' })).sort((a, b) => compare(`${a.entityId}|${a.property}`, `${b.entityId}|${b.property}`));
}
function boundedInteger(value, fallback, min, max, name) { const result = value ?? fallback; if (!Number.isInteger(result) || result < min || result > max) fail('INVALID_LIMIT', `${name} is outside the supported range.`); return result; }
export function buildGraph(ledger, options = {}) {
  assertLedger(ledger); assertSafeData(options);
  object(options, ['maxNodes', 'maxEdges', 'maxHops', 'seedIds', 'includeEvidence', 'sourceIds']);
  const maxNodes = boundedInteger(options.maxNodes, 200, 1, 500, 'Node limit');
  const maxEdges = boundedInteger(options.maxEdges, 400, 0, 1000, 'Edge limit');
  const maxHops = boundedInteger(options.maxHops, 2, 0, 5, 'Hop limit');
  if (options.includeEvidence !== undefined && typeof options.includeEvidence !== 'boolean') fail('INVALID_SCHEMA', 'includeEvidence must be boolean.');
  const sourceFilter = options.sourceIds == null ? null : new Set(refs(options.sourceIds, new Set(ledger.sources.map((row) => row.id)), 'Source filter'));
  const observations = ledger.observations.filter((row) => !sourceFilter || sourceFilter.has(row.sourceId));
  const allowedObservations = new Set(observations.map((row) => row.id));
  const claims = ledger.claims.filter((row) => row.evidenceIds.some((ref) => allowedObservations.has(ref)));
  const matches = activeMatches(ledger).filter((row) => row.evidenceIds.some((ref) => allowedObservations.has(ref)));
  const nodes = new Map(); const edges = [];
  const add = (node) => nodes.set(node.id, node);
  const linkedEntityIds = new Set([...observations.map((row) => row.entityId), ...claims.flatMap((row) => [row.subjectId, row.objectId]).filter(Boolean), ...matches.flatMap((row) => [row.leftId, row.rightId])]);
  for (const entity of sorted(ledger.entities)) if (!sourceFilter || linkedEntityIds.has(entity.id)) add({ id: `entity:${entity.id}`, recordId: entity.id, kind: 'entity', type: entity.type, label: entity.label });
  for (const claim of sorted(claims)) {
    if (claim.objectId) edges.push({ id: `claim-edge:${claim.id}`, source: `entity:${claim.subjectId}`, target: `entity:${claim.objectId}`, type: claim.predicate, kind: 'claim', claimId: claim.id, reviewStatus: claim.status, evidenceIds: [...claim.evidenceIds], counterEvidenceIds: [...claim.counterEvidenceIds] });
    if (options.includeEvidence !== false) {
      add({ id: `claim:${claim.id}`, recordId: claim.id, kind: 'claim', type: 'Claim', label: claim.predicate, reviewStatus: claim.status });
      edges.push({ id: `subject:${claim.id}`, source: `entity:${claim.subjectId}`, target: `claim:${claim.id}`, type: 'asserts', kind: 'evidence' });
      if (claim.objectId) edges.push({ id: `object:${claim.id}`, source: `claim:${claim.id}`, target: `entity:${claim.objectId}`, type: 'about', kind: 'evidence' });
      for (const ref of claim.evidenceIds) if (allowedObservations.has(ref)) edges.push({ id: `supports:${claim.id}:${ref}`, source: `claim:${claim.id}`, target: `observation:${ref}`, type: 'supported_by', kind: 'evidence' });
      for (const ref of claim.counterEvidenceIds) if (allowedObservations.has(ref)) edges.push({ id: `counters:${claim.id}:${ref}`, source: `claim:${claim.id}`, target: `observation:${ref}`, type: 'countered_by', kind: 'evidence' });
    }
  }
  for (const match of matches) edges.push({ id: `match:${match.id}`, source: `entity:${match.leftId}`, target: `entity:${match.rightId}`, type: 'same_identity_reviewed', kind: 'match', reviewId: match.id, reviewStatus: 'accepted', evidenceIds: [...match.evidenceIds], counterEvidenceIds: [...match.counterEvidenceIds] });
  if (options.includeEvidence !== false) {
    for (const observation of sorted(observations)) {
      add({ id: `observation:${observation.id}`, recordId: observation.id, kind: 'observation', type: 'Observation', label: `${observation.property}: ${String(observation.value).slice(0, 120)}` });
      edges.push({ id: `observed:${observation.id}`, source: `entity:${observation.entityId}`, target: `observation:${observation.id}`, type: 'has_observation', kind: 'evidence' });
      edges.push({ id: `source:${observation.id}`, source: `observation:${observation.id}`, target: `source:${observation.sourceId}`, type: 'documented_by', kind: 'evidence' });
    }
    const used = new Set(observations.map((row) => row.sourceId));
    for (const source of sorted(ledger.sources)) if (used.has(source.id)) add({ id: `source:${source.id}`, recordId: source.id, kind: 'source', type: 'Source', label: source.label });
  }
  let chosen = new Set(nodes.keys());
  if (options.seedIds) {
    const seeds = refs(options.seedIds, new Set(ledger.entities.map((row) => row.id)), 'Graph seeds');
    chosen = new Set(seeds.map((seed) => `entity:${seed}`).filter((seed) => nodes.has(seed)));
    let frontier = new Set(chosen);
    for (let hop = 0; hop < maxHops; hop++) {
      const next = new Set();
      for (const edge of edges) { if (frontier.has(edge.source) && !chosen.has(edge.target)) next.add(edge.target); if (frontier.has(edge.target) && !chosen.has(edge.source)) next.add(edge.source); }
      for (const item of next) chosen.add(item);
      frontier = next;
    }
  }
  const rank = { entity: 0, claim: 1, observation: 2, source: 3 };
  const candidates = [...nodes.values()].filter((node) => chosen.has(node.id)).sort((a, b) => rank[a.kind] - rank[b.kind] || compare(a.id, b.id));
  const allEdges = edges.filter((edge) => chosen.has(edge.source) && chosen.has(edge.target)).sort((a, b) => compare(a.id, b.id));
  const selectedNodes = candidates.slice(0, maxNodes); const selected = new Set(selectedNodes.map((node) => node.id));
  const selectedEdges = allEdges.filter((edge) => selected.has(edge.source) && selected.has(edge.target)).slice(0, maxEdges);
  return { nodes: selectedNodes, edges: selectedEdges, totalNodes: candidates.length, totalEdges: allEdges.length, omittedNodes: candidates.length - selectedNodes.length, omittedEdges: allEdges.length - selectedEdges.length, truncated: candidates.length > selectedNodes.length || allEdges.length > selectedEdges.length };
}
export function buildTimeline(ledger, { limit = 200 } = {}) {
  assertLedger(ledger); boundedInteger(limit, 200, 1, 1000, 'Timeline limit');
  const dated = ledger.observations.filter((row) => row.eventTime).sort((a, b) => compare(a.eventTime.value, b.eventTime.value) || compare(a.id, b.id));
  const entries = dated.slice(0, limit).map((row) => ({ ...copy(row), entity: copy(ledger.entities.find((item) => item.id === row.entityId)), source: copy(ledger.sources.find((item) => item.id === row.sourceId)) }));
  return { entries, undatedIds: ledger.observations.filter((row) => !row.eventTime).map((row) => row.id).sort(), totalDated: dated.length, omitted: dated.length - entries.length, note: 'Sorted by asserted event time. Capture/retrieval time is never substituted for an unknown event date.' };
}

function filePath(value) {
  text(value, 'Relative file path', 240);
  if (value.startsWith('/') || /[\\:%\u0000]/.test(value) || value.split('/').some((part) => !part || part === '.' || part === '..' || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) fail('INVALID_FILE_PATH', 'Bundle paths must be safe relative paths.');
  return value;
}
function fileInputs(files) {
  values(files, 'Files', LIMITS.files);
  const seen = new Set(); let total = 0;
  return files.map((file) => {
    object(file, ['path', 'bytes', 'mediaType', 'sourceUrl', 'capturedAt'], ['path', 'bytes']);
    const path = filePath(file.path);
    if (seen.has(path)) fail('CONFLICT', 'Bundle file paths must be unique.');
    seen.add(path);
    const bytes = toBytes(file.bytes); total += bytes.byteLength;
    if (total > LIMITS.bundleBytes) fail('IMPORT_LIMIT', 'Bundle exceeds the total byte limit.');
    return { ...file, path, bytes };
  }).sort((a, b) => compare(a.path, b.path));
}
function assertManifest(manifest) {
  assertSafeData(manifest);
  object(manifest, ['schema', 'algorithm', 'actor', 'capturedAt', 'sourceUrl', 'files', 'digest'], ['schema', 'algorithm', 'actor', 'capturedAt', 'sourceUrl', 'files', 'digest']);
  if (manifest.schema !== 'capture-manifest/v1' || manifest.algorithm !== 'SHA-256') fail('INVALID_SCHEMA', 'Unsupported capture manifest.');
  text(manifest.actor, 'Manifest actor', 160); timestamp(manifest.capturedAt); safeSourceURL(manifest.sourceUrl); hash(manifest.digest);
  const seen = new Set(); let total = 0;
  for (const file of values(manifest.files, 'Manifest files', LIMITS.files)) {
    object(file, ['path', 'sha256', 'size', 'mediaType', 'sourceUrl', 'capturedAt'], ['path', 'sha256', 'size', 'mediaType', 'sourceUrl', 'capturedAt']);
    filePath(file.path); hash(file.sha256); text(file.mediaType, 'Media type', 120); safeSourceURL(file.sourceUrl); timestamp(file.capturedAt);
    if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > LIMITS.fileBytes) fail('IMPORT_LIMIT', 'Manifest file size is outside the limit.');
    total += file.size; if (total > LIMITS.bundleBytes) fail('IMPORT_LIMIT', 'Manifest exceeds the bundle byte limit.');
    if (seen.has(file.path)) fail('CONFLICT', 'Manifest paths must be distinct.'); seen.add(file.path);
  }
}
async function verifyManifestDigest(manifest) { assertManifest(manifest); const { digest, ...body } = manifest; return digest === await sha256(canonicalJSON(body)); }
export async function createCaptureManifest(files, { actor, capturedAt = new Date().toISOString(), sourceUrl = null } = {}) {
  const captured = timestamp(capturedAt); const source = safeSourceURL(sourceUrl);
  const entries = [];
  for (const file of fileInputs(files)) entries.push({ path: file.path, sha256: await sha256(file.bytes), size: file.bytes.byteLength, mediaType: text(file.mediaType ?? 'application/octet-stream', 'Media type', 120), sourceUrl: safeSourceURL(file.sourceUrl ?? source), capturedAt: timestamp(file.capturedAt ?? captured) });
  const body = { schema: 'capture-manifest/v1', algorithm: 'SHA-256', actor: text(actor, 'Manifest actor', 160), capturedAt: captured, sourceUrl: source, files: entries };
  return { ...body, digest: await sha256(canonicalJSON(body)) };
}
export async function verifyCaptureManifest(manifest, files, { expectedDigest = null } = {}) {
  assertManifest(manifest);
  if (expectedDigest !== null) hash(expectedDigest);
  const provided = fileInputs(files); const map = new Map(provided.map((file) => [file.path, file]));
  const missing = []; const results = [];
  for (const file of manifest.files) {
    const actual = map.get(file.path);
    if (!actual) { missing.push(file.path); results.push({ path: file.path, ok: false, reason: 'missing' }); continue; }
    const ok = actual.bytes.byteLength === file.size && await sha256(actual.bytes) === file.sha256;
    results.push({ path: file.path, ok, reason: ok ? null : 'content_mismatch' });
  }
  const unexpected = provided.filter((file) => !manifest.files.some((row) => row.path === file.path)).map((file) => file.path);
  const manifestDigestValid = await verifyManifestDigest(manifest);
  const checkpointMatches = expectedDigest === null ? null : expectedDigest === manifest.digest;
  return { ok: manifestDigestValid && checkpointMatches !== false && missing.length === 0 && unexpected.length === 0 && results.every((row) => row.ok), manifestDigestValid, checkpointMatches, files: results, missing, unexpected, authenticity: 'not_established' };
}
export async function attachCaptureManifest(ledger, manifest, context) {
  if (!await verifyManifestDigest(manifest)) fail('INTEGRITY_CHECK_FAILED', 'Capture manifest digest does not match.');
  const next = await verifiedCopy(ledger); const artifact = { id: `artifact-${manifest.digest}`, manifest: copy(manifest) };
  if (!insertRecord(next.artifacts, artifact)) return next;
  next.artifacts = sorted(next.artifacts);
  return seal(next, 'artifact.attached', { artifactId: artifact.id, manifestDigest: manifest.digest }, context);
}
export async function importLedgerJSON(input, { expectedHead = null } = {}) {
  const ledger = parseEvidenceJSON(input);
  if (!(await verifyLedger(ledger, { expectedHead })).ok) fail('INTEGRITY_CHECK_FAILED', 'Imported ledger failed digest verification.');
  return copy(ledger);
}
