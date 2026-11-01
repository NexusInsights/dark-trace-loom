import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { LIMITS, activeMatches, assertSafeData, attachCaptureManifest, buildGraph, buildTimeline, canonicalJSON, createCaptureManifest, createLedger, evidenceSummary, findConflicts, importLedgerJSON, ingestEvidence, normalizeEventTime, parseEvidenceJSON, reviewClaim, reviewMatch, safeJSONStringify, sha256, verifyCaptureManifest, verifyLedger } from './evidence-core.mjs';
import { csvCell, exportCSV, exportEvidenceBundle, exportFtM, exportGEXF, exportMaltegoCSV, exportMarkdown, exportPROV, exportSTIX, importHunchlyCapture } from './evidence-formats.mjs';

const at = '2026-11-01T12:00:00.000Z';
const context = { actor: 'synthetic-reviewer', at };
const fresh = () => createLedger({ caseId: 'synthetic-case', title: 'Synthetic evidence only', createdAt: at });
const clone = (value) => JSON.parse(JSON.stringify(value));
const hasCode = (code) => (error) => error?.code === code;
const batch = () => ({
  source: { id: 'source-a', label: 'Synthetic registry', url: 'https://example.invalid/registry', provider: 'fixture', independence: 'independent', independenceGroup: 'publisher-a' },
  entities: [{ id: 'person-a', type: 'Person', label: 'Same Display Name' }, { id: 'person-b', type: 'Person', label: 'Same Display Name' }, { id: 'company-a', type: 'Company', label: 'Synthetic Company' }, { id: 'ip-a', type: 'IPAddress', label: '192.0.2.10' }, { id: 'domain-a', type: 'Domain', label: 'example.invalid' }],
  observations: [
    { id: 'obs-a', entityId: 'person-a', property: 'employer', value: 'Synthetic Alpha', eventTime: '2020-01-02' },
    { id: 'obs-b', entityId: 'person-b', property: 'identifier', value: 'synthetic-distinct-record' },
    { id: 'obs-ip', entityId: 'ip-a', property: 'value', value: '192.0.2.10', eventTime: '2021-02-03T04:05:06Z' },
    { id: 'obs-domain', entityId: 'domain-a', property: 'value', value: 'example.invalid', eventTime: '2022-01-01' },
  ],
  claims: [{ id: 'claim-a', subjectId: 'person-a', predicate: 'owns', objectId: 'company-a', evidenceIds: ['obs-a'] }],
});
async function fixture() { return ingestEvidence(fresh(), batch(), context); }
async function withConflict() {
  return ingestEvidence(await fixture(), { source: { id: 'source-b', label: 'Synthetic mirror', url: 'https://example.invalid/mirror', independence: 'independent', independenceGroup: 'publisher-a' }, observations: [{ id: 'obs-c', entityId: 'person-a', property: 'employer', value: 'Synthetic Beta', eventTime: '2019-06-01' }], claims: [{ id: 'claim-b', subjectId: 'person-a', predicate: 'employer', value: 'Synthetic Alpha', evidenceIds: ['obs-a', 'obs-c'] }] }, context);
}

test('full evidence workflow preserves source conflicts, review, export and verified JSON reload', async () => {
  const initial = fresh();
  let ledger = await withConflict();
  assert.equal(initial.entities.length, 0);
  assert.equal(ledger.entities.filter((row) => row.type === 'Person').length, 2);
  ledger = await reviewClaim(ledger, 'claim-a', { ...context, decision: 'accepted', reason: 'Reviewed synthetic registry statement', counterEvidenceIds: ['obs-c'] });
  assert.equal(ledger.claims.find((row) => row.id === 'claim-a').status, 'accepted');
  const report = exportMarkdown(ledger);
  assert.match(report, /Synthetic Alpha/); assert.match(report, /Synthetic Beta/); assert.match(report, /Counterevidence/);
  const head = ledger.audit.at(-1).digest;
  const restored = await importLedgerJSON(safeJSONStringify(ledger), { expectedHead: head });
  assert.deepEqual(restored, ledger);
  assert.equal((await verifyLedger(restored, { expectedHead: head })).ok, true);
});

test('same names and identifiers never automatically merge or link identities', async () => {
  const input = batch(); input.entities[0].identifiers = [{ type: 'alias', value: 'shared-alias' }]; input.entities[1].identifiers = [{ type: 'alias', value: 'shared-alias' }];
  const ledger = await ingestEvidence(fresh(), input, context);
  assert.equal(ledger.entities.length, 5); assert.equal(activeMatches(ledger).length, 0);
  assert.equal(buildGraph(ledger).edges.filter((edge) => edge.kind === 'match').length, 0);
});

test('repeat imports deduplicate and do not reset accepted claim status', async () => {
  const original = await fixture();
  const reviewed = await reviewClaim(original, 'claim-a', { ...context, decision: 'accepted', reason: 'Reviewed supporting source' });
  const input = batch(); input.observations.forEach((row) => { row.capturedAt = '2026-11-01T13:00:00Z'; });
  const duplicate = await ingestEvidence(reviewed, input, context);
  assert.deepEqual(duplicate, reviewed); assert.equal(original.claims[0].status, 'unreviewed');
});

test('conflicting observations survive; reused IDs cannot overwrite evidence', async () => {
  const ledger = await withConflict(); const conflicts = findConflicts(ledger);
  assert.equal(conflicts.length, 1); assert.deepEqual(conflicts[0].observations.map((row) => row.value), ['Synthetic Alpha', 'Synthetic Beta']);
  const input = batch(); input.observations[0].value = 'changed';
  await assert.rejects(ingestEvidence(ledger, input, context), hasCode('OBSERVATION_CONFLICT'));
  assert.equal(ledger.observations.find((row) => row.id === 'obs-a').value, 'Synthetic Alpha');
});

test('reusing entity/source IDs with new metadata fails instead of silently choosing a value', async () => {
  const ledger = await fixture(); const entityInput = batch(); entityInput.entities[0].label = 'New assertion';
  await assert.rejects(ingestEvidence(ledger, entityInput, context), hasCode('ENTITY_CONFLICT'));
  const sourceInput = batch(); sourceInput.source.url = 'https://example.invalid/other';
  await assert.rejects(ingestEvidence(ledger, sourceInput, context), hasCode('SOURCE_CONFLICT'));
});

test('unknown/empty values are not promoted to conflicting negative evidence', async () => {
  const ledger = await ingestEvidence(await fixture(), { source: { id: 'unknown-source', label: 'Synthetic unknown value' }, observations: [{ id: 'obs-null', entityId: 'person-a', property: 'employer', value: null }, { id: 'obs-empty', entityId: 'person-a', property: 'employer', value: '' }] }, context);
  assert.equal(findConflicts(ledger).length, 0); assert.equal(ledger.observations.find((row) => row.id === 'obs-null').value, null);
});

test('source independence groups are explicit and mirrors do not become two independent groups', async () => {
  const summary = evidenceSummary(await withConflict(), 'claim-b');
  assert.equal(summary.sourceCount, 2); assert.deepEqual(summary.declaredIndependentGroups, ['publisher-a']);
  assert.equal(summary.independenceAssessment, 'analyst_declared_not_verified'); assert.equal(Object.hasOwn(summary, 'probability'), false);
  const input = batch(); delete input.source.independenceGroup;
  await assert.rejects(ingestEvidence(fresh(), input, context), hasCode('INVALID_SCHEMA'));
});

test('manual matches require reason/evidence, retain counterevidence, and revoke without deleting records', async () => {
  const ledger = await withConflict();
  await assert.rejects(reviewMatch(ledger, { ...context, leftId: 'person-a', rightId: 'person-b', decision: 'accepted', reason: 'x', evidenceIds: [] }), hasCode('INVALID_SCHEMA'));
  const accepted = await reviewMatch(ledger, { ...context, leftId: 'person-b', rightId: 'person-a', decision: 'accepted', reason: 'Synthetic manual resolution, not an automatic name match', evidenceIds: ['obs-a'], counterEvidenceIds: ['obs-b'] });
  assert.equal(activeMatches(accepted).length, 1); assert.equal(accepted.entities.length, ledger.entities.length);
  const revoked = await reviewMatch(accepted, { ...context, leftId: 'person-a', rightId: 'person-b', decision: 'revoked', reason: 'Counterevidence establishes distinct synthetic records', evidenceIds: [], counterEvidenceIds: ['obs-b'] });
  assert.equal(activeMatches(revoked).length, 0); assert.equal(revoked.reviews.length, 2); assert.equal(accepted.reviews.length, 1);
  assert.equal(buildGraph(revoked).edges.filter((edge) => edge.kind === 'match').length, 0);
  assert.equal((await verifyLedger(revoked)).ok, true);
  await assert.rejects(reviewMatch(revoked, { ...context, leftId: 'person-a', rightId: 'person-b', decision: 'revoked', reason: 'Already revoked', evidenceIds: [] }), hasCode('INVALID_REVIEW_TRANSITION'));
});

test('review transitions and counterevidence are audited without modifying original observations', async () => {
  const ledger = await withConflict(); const observations = canonicalJSON(ledger.observations);
  let next = await reviewClaim(ledger, 'claim-a', { ...context, decision: 'accepted', reason: 'Initially accepted' });
  next = await reviewClaim(next, 'claim-a', { ...context, decision: 'needs_review', reason: 'New contradictory source', counterEvidenceIds: ['obs-c'] });
  assert.equal(next.claims.find((row) => row.id === 'claim-a').status, 'needs_review');
  assert.equal(next.reviews.length, 2); assert.equal(canonicalJSON(next.observations), observations);
  await assert.rejects(reviewClaim(next, 'claim-a', { ...context, decision: 'accepted', reason: 'Invalid same evidence', counterEvidenceIds: ['obs-a'] }), hasCode('INVALID_REFERENCE'));
});

test('ledger audit/content tamper and checkpoint replacement are detected', async () => {
  const ledger = await fixture(); const head = ledger.audit.at(-1).digest;
  const changedContent = clone(ledger); changedContent.observations[0].value = 'tampered';
  assert.equal((await verifyLedger(changedContent)).ok, false);
  await assert.rejects(ingestEvidence(changedContent, batch(), context), hasCode('INTEGRITY_CHECK_FAILED'));
  const changedAudit = clone(ledger); changedAudit.audit[0].actor = 'different actor';
  assert.equal((await verifyLedger(changedAudit)).ok, false);
  assert.equal((await verifyLedger(ledger, { expectedHead: '0'.repeat(64) })).ok, false);
  assert.equal((await verifyLedger(ledger, { expectedHead: head })).checkpointChecked, true);
  await assert.rejects(importLedgerJSON(JSON.stringify(changedContent)), hasCode('INTEGRITY_CHECK_FAILED'));
});

test('removing audit from a nonempty ledger fails integrity verification', async () => {
  const ledger = await fixture(); ledger.audit = [];
  assert.equal((await verifyLedger(ledger)).ok, false);
});

test('canonical hashing agrees with an independent SHA-256 implementation', async () => {
  assert.equal(await sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(canonicalJSON({ b: 2, a: 1 }), '{"a":1,"b":2}');
  const ledger = await fixture(); const { audit, ...body } = ledger;
  assert.equal(audit[0].snapshotDigest, createHash('sha256').update(canonicalJSON(body)).digest('hex'));
});

test('byte hashing accepts branded cross-realm Uint8Array/ArrayBuffer and rejects lookalikes', async () => {
  const bytes = runInNewContext('new Uint8Array([97,98,99])');
  const buffer = runInNewContext('new Uint8Array([97,98,99]).buffer');
  const expected = createHash('sha256').update('abc').digest('hex');
  assert.equal(await sha256(bytes), expected); assert.equal(await sha256(buffer), expected);
  let invoked = false; const fake = { [Symbol.toStringTag]: 'ArrayBuffer' }; Object.defineProperty(fake, 'byteLength', { get() { invoked = true; return 3; } });
  await assert.rejects(sha256(fake), hasCode('INVALID_FILE')); assert.equal(invoked, false);
  await assert.rejects(sha256(new Uint16Array([97,98,99])), hasCode('INVALID_FILE'));
});

test('timeline orders real event dates, retains precision and never uses retrieval time', async () => {
  const timeline = buildTimeline(await withConflict());
  assert.deepEqual(timeline.entries.map((row) => row.id), ['obs-c', 'obs-a', 'obs-ip', 'obs-domain']);
  assert.deepEqual(timeline.undatedIds, ['obs-b']); assert.equal(timeline.entries[1].eventTime.precision, 'day');
  assert.equal(timeline.entries.every((row) => row.capturedAt.startsWith('2026-11-01')), true);
  assert.deepEqual(normalizeEventTime('2020-01-02T01:00:00+01:00'), { value: '2020-01-02T00:00:00.000Z', precision: 'timestamp' });
  for (const invalid of ['2026-02-30', 'yesterday', '2020-01-01T10:00:00', '2020-01-01T25:00:00Z']) assert.throws(() => normalizeEventTime(invalid), hasCode('INVALID_DATE'));
});

test('bounded graph is deterministic, includes explicit evidence edges, and never has dangling edges', async () => {
  const ledger = await withConflict(); const graph = buildGraph(ledger);
  assert.ok(graph.edges.some((edge) => edge.type === 'supported_by')); assert.ok(graph.edges.some((edge) => edge.type === 'documented_by'));
  assert.deepEqual(graph, buildGraph(ledger));
  const bounded = buildGraph(ledger, { maxNodes: 3, maxEdges: 1 }); const selected = new Set(bounded.nodes.map((node) => node.id));
  assert.equal(bounded.nodes.length, 3); assert.ok(bounded.edges.length <= 1); assert.equal(bounded.truncated, true);
  assert.ok(bounded.edges.every((edge) => selected.has(edge.source) && selected.has(edge.target)));
  assert.deepEqual(buildGraph(ledger, { seedIds: ['person-a'], maxHops: 0 }).nodes.map((row) => row.id), ['entity:person-a']);
  assert.throws(() => buildGraph(ledger, { maxNodes: 501 }), hasCode('INVALID_LIMIT'));
});

test('graph source filters exclude unrelated observations and supporting paths', async () => {
  const graph = buildGraph(await withConflict(), { sourceIds: ['source-b'] });
  assert.ok(graph.nodes.some((row) => row.id === 'observation:obs-c'));
  assert.ok(!graph.nodes.some((row) => row.id === 'observation:obs-a'));
  assert.ok(!graph.nodes.some((row) => row.id === 'entity:person-b'));
});

test('strict input rejects unknown status, absent evidence and exotic entity types', async () => {
  const injected = batch(); injected.claims[0].status = 'accepted';
  await assert.rejects(ingestEvidence(fresh(), injected, context), hasCode('INVALID_SCHEMA'));
  const absent = batch(); absent.claims[0].evidenceIds = ['not-found'];
  await assert.rejects(ingestEvidence(fresh(), absent, context), hasCode('INVALID_REFERENCE'));
  const type = batch(); type.entities[0].type = 'person-sco';
  await assert.rejects(ingestEvidence(fresh(), type, context), hasCode('INVALID_SCHEMA'));
});

test('untrusted JSON rejects pollution, accessors, XML entities, cycles, sparse arrays and limits', () => {
  for (const input of ['{"__proto__":{"polluted":true}}', '{"safe":{"constructor":{}}}', '{"prototype":{}}']) assert.throws(() => parseEvidenceJSON(input), hasCode('UNSAFE_KEY'));
  assert.equal({}.polluted, undefined);
  let invoked = false; const accessor = {}; Object.defineProperty(accessor, 'value', { enumerable: true, get() { invoked = true; return 1; } });
  assert.throws(() => assertSafeData(accessor), hasCode('INVALID_DATA')); assert.equal(invoked, false);
  const cycle = {}; cycle.self = cycle; assert.throws(() => assertSafeData(cycle), hasCode('INVALID_DATA'));
  assert.throws(() => assertSafeData(new Array(4)), hasCode('IMPORT_LIMIT'));
  assert.throws(() => parseEvidenceJSON('<!DOCTYPE x [<!ENTITY external SYSTEM "file:///private">]><x>&external;</x>'), hasCode('INVALID_JSON'));
  assert.throws(() => parseEvidenceJSON('"123456789"', { maxBytes: 5 }), hasCode('IMPORT_LIMIT'));
  assert.throws(() => assertSafeData({ a: { b: 1 } }, { maxDepth: 1 }), hasCode('IMPORT_LIMIT'));
  assert.throws(() => assertSafeData({ a: Infinity }), hasCode('INVALID_DATA'));
  assert.throws(() => assertSafeData({ ['k'.repeat(1025)]: 1 }), hasCode('IMPORT_LIMIT'));
  assert.throws(() => assertSafeData({ value: '\ud800' }), hasCode('INVALID_DATA'));
});

test('file manifest verifies exact bytes independently and detects mutation/missing/extra files', async () => {
  const files = [{ path: 'original.txt', bytes: 'abc', mediaType: 'text/plain' }];
  const manifest = await createCaptureManifest(files, { actor: context.actor, capturedAt: at });
  assert.equal(manifest.files[0].sha256, createHash('sha256').update('abc').digest('hex'));
  assert.equal((await verifyCaptureManifest(manifest, files, { expectedDigest: manifest.digest })).ok, true);
  assert.equal((await verifyCaptureManifest(manifest, [{ path: 'original.txt', bytes: 'abd' }])).ok, false);
  assert.deepEqual((await verifyCaptureManifest(manifest, [])).missing, ['original.txt']);
  assert.deepEqual((await verifyCaptureManifest(manifest, [...files, { path: 'extra.txt', bytes: 'x' }])).unexpected, ['extra.txt']);
  const modified = clone(manifest); modified.files[0].mediaType = 'text/html';
  assert.equal((await verifyCaptureManifest(modified, files)).manifestDigestValid, false);
  const ledger = await attachCaptureManifest(fresh(), manifest, context);
  assert.equal((await verifyLedger(ledger)).ok, true);
});

test('file bundle rejects traversal, duplicate paths, accessors and oversized input', async () => {
  for (const path of ['../secret', '/absolute', 'C:/secret', 'safe/../secret', 'safe\\secret', 'a//b', '%2e%2e/secret', 'safe/.. /secret', 'CON', 'file.']) await assert.rejects(createCaptureManifest([{ path, bytes: 'x' }], { actor: 'fixture' }), hasCode('INVALID_FILE_PATH'));
  await assert.rejects(createCaptureManifest([{ path: 'a', bytes: '1' }, { path: 'a', bytes: '2' }], { actor: 'fixture' }), hasCode('CONFLICT'));
  await assert.rejects(createCaptureManifest([{ path: 'a', bytes: new Uint8Array(LIMITS.fileBytes + 1) }], { actor: 'fixture' }), hasCode('IMPORT_LIMIT'));
  let accessed = false; const file = { path: 'a' }; Object.defineProperty(file, 'bytes', { enumerable: true, get() { accessed = true; return 'x'; } });
  await assert.rejects(createCaptureManifest([file], { actor: 'fixture' }), hasCode('INVALID_SCHEMA')); assert.equal(accessed, false);
});

test('CSV formula injection and quoting are neutralized across exported values', async () => {
  for (const formula of ['=1+1', '+cmd', '-cmd', '@SUM(A1)', '  =HYPERLINK("x")', '\t=1+1', '\r=1+1']) assert.ok(csvCell(formula).startsWith('"\''));
  assert.equal(csvCell('a,"b"\nc'), '"a,""b""\nc"');
  const input = batch(); input.entities[0].label = '=HYPERLINK("https://example.invalid")';
  const ledger = await ingestEvidence(fresh(), input, context);
  assert.match(exportCSV(ledger), /"'=HYPERLINK/); assert.match(exportMaltegoCSV(ledger).entitiesCSV, /"'=HYPERLINK/);
});

test('JSON/Markdown/XML exports keep hostile strings inert and never parse input XML', async () => {
  const input = batch(); input.entities[0].label = '<script>alert("x")</script> & "bad"';
  const ledger = await ingestEvidence(fresh(), input, context);
  const json = safeJSONStringify(ledger); assert.ok(!json.includes('<script>')); assert.deepEqual(JSON.parse(json), ledger);
  const report = exportMarkdown(ledger); assert.ok(!report.includes('<script>')); assert.match(report, /&lt;script&gt;/);
  const graph = exportGEXF(ledger); assert.ok(!graph.xml.includes('<script>')); assert.match(graph.xml, /&lt;script&gt;/); assert.ok(!graph.xml.includes('<!DOCTYPE'));
});

test('Maltego CSV keeps stable entity IDs, explicit types and directional connectivity separate from names', async () => {
  const output = exportMaltegoCSV(await fixture());
  assert.match(output.entitiesCSV, /"person-a","maltego.Phrase","person-a","Same Display Name","Person"/);
  assert.match(output.entitiesCSV, /"person-b","maltego.Phrase","person-b","Same Display Name","Person"/);
  assert.match(output.linksCSV, /"person-a","company-a","owns","claim-a"/);
  assert.equal(output.mapping.entityId, 'EntityID'); assert.equal(output.integration, 'offline_tabular_format_only');
});

test('FtM projection uses documented schema names and accepted Ownership; reports lossy fields', async () => {
  let ledger = await fixture();
  assert.equal(exportFtM(ledger).entities.some((row) => row.schema === 'Ownership'), false);
  ledger = await reviewClaim(ledger, 'claim-a', { ...context, decision: 'accepted', reason: 'Reviewed synthetic ownership assertion' });
  const result = exportFtM(ledger); const ownership = result.entities.find((row) => row.schema === 'Ownership');
  assert.deepEqual(ownership.properties.owner, ['person-a']); assert.deepEqual(ownership.properties.asset, ['company-a']);
  assert.ok(result.skipped.some((row) => row.id === 'ip-a')); assert.equal(result.ndjson.trim().split('\n').every((line) => typeof JSON.parse(line).properties === 'object'), true);
  assert.ok(result.entities.every((row) => Object.values(row.properties).every(Array.isArray)));
});

test('PROV JSON derivations and activities reference declared entities and agents', async () => {
  const ledger = await fixture(); const prov = exportPROV(ledger);
  assert.equal(prov.prefix.prov, 'http://www.w3.org/ns/prov#');
  for (const relation of Object.values(prov.wasDerivedFrom)) { assert.ok(prov.entity[relation['prov:generatedEntity']]); assert.ok(prov.entity[relation['prov:usedEntity']]); }
  for (const relation of Object.values(prov.wasAssociatedWith)) { assert.ok(prov.activity[relation['prov:activity']]); assert.ok(prov.agent[relation['prov:agent']]); }
  assert.match(safeJSONStringify(prov), /snapshotSha256/);
});

test('STIX exports only supported cyber observations with precise event time, never Person SCOs', async () => {
  const result = await exportSTIX(await fixture(), { generatedAt: at });
  assert.deepEqual(result.bundle.objects.map((row) => row.type), ['ipv4-addr', 'observed-data']);
  const observed = result.bundle.objects[1]; assert.equal(observed.first_observed, '2021-02-03T04:05:06.000Z'); assert.equal(observed.created, at); assert.equal(observed.number_observed, 1);
  assert.equal(observed.object_refs[0], result.bundle.objects[0].id); assert.match(observed.id, /^observed-data--[\da-f-]{14}4[\da-f-]+$/);
  assert.ok(result.skipped.some((row) => row.id === 'obs-domain' && row.reason.includes('timestamp')));
  assert.ok(result.skipped.some((row) => row.id === 'obs-a')); assert.equal(result.bundle.objects.some((row) => row.type === 'person'), false);
});

test('STIX SCO identifiers implement normative UUIDv5 independently and deduplicate values', async () => {
  let ledger = await fixture();
  ledger = await ingestEvidence(ledger, { source: { id: 'second-cyber-source', label: 'Second synthetic observation' }, observations: [{ id: 'obs-ip-second', entityId: 'ip-a', property: 'value', value: '192.0.2.10', eventTime: '2022-01-01T00:00:00Z' }] }, context);
  const result = await exportSTIX(ledger, { generatedAt: at });
  const input = Buffer.concat([Buffer.from('00abedb4aa42466c9c01fed23315a9b7', 'hex'), Buffer.from('{"value":"192.0.2.10"}')]);
  const hash = createHash('sha1').update(input).digest().subarray(0, 16); hash[6] = (hash[6] & 15) | 80; hash[8] = (hash[8] & 63) | 128;
  const h = hash.toString('hex'); const expected = `ipv4-addr--${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  assert.equal(result.bundle.objects.filter((row) => row.type === 'ipv4-addr').length, 1); assert.equal(result.bundle.objects[0].id, expected);
  assert.equal(result.bundle.objects.filter((row) => row.type === 'observed-data').length, 2);
});

test('Hunchly import validates original MHTML bytes while forwarded HTML has its own digest', async () => {
  const original = 'Synthetic original MHTML bytes'; const hash = createHash('sha256').update(original).digest('hex');
  const payload = { page_content: '<html><script>throw new Error("must not execute")</script>synthetic</html>', javascript: 'throw new Error("must not execute")', case_information: { case_id: 2, case_name: 'Synthetic case', case_information: { Investigator: 'Fixture' } }, data: [{ data: 'test@example.invalid', data_extractor: 'Email Address', data_type: 'Accounts' }], page: { case_id: 2, page_id: 7, hash, timestamp_created: '2023-01-02T03:04:05Z', title: 'Synthetic capture', url: 'https://example.invalid/capture' }, photos: [] };
  const result = await importHunchlyCapture(fresh(), JSON.stringify(payload), { ...context, deviceId: 'fixture-device', mhtmlBytes: original });
  assert.equal(result.capture.originalBytesVerified, true); assert.equal(result.integration.vendorConnectionVerified, false);
  assert.equal(result.capture.manifest.files.find((row) => row.path === 'original.mhtml').sha256, hash);
  assert.notEqual(result.capture.manifest.files.find((row) => row.path === 'capture.html').sha256, hash);
  assert.equal(buildTimeline(result.ledger).entries.length, 0); assert.equal(result.ledger.observations.every((row) => row.capturedAt === '2023-01-02T03:04:05.000Z'), true);
  assert.equal((await verifyLedger(result.ledger)).ok, true);
  await assert.rejects(importHunchlyCapture(fresh(), payload, { ...context, deviceId: 'fixture-device', mhtmlBytes: 'tampered' }), hasCode('MHTML_HASH_MISMATCH'));
});

test('Hunchly missing originals are explicit; duplicate captures dedup by device/case/page/hash', async () => {
  const payload = { page: { case_id: 1, page_id: 1, hash: 'a'.repeat(64), timestamp_created: '2020-01-01T00:00:00Z', title: 'Synthetic', url: 'https://example.invalid/' } };
  const first = await importHunchlyCapture(fresh(), payload, { ...context, deviceId: 'device-a' });
  assert.equal(first.capture.originalBytesVerified, false); assert.match(first.warnings[0], /not verified/);
  const second = await importHunchlyCapture(first.ledger, payload, { ...context, deviceId: 'device-a' }); assert.deepEqual(second.ledger, first.ledger);
  const third = await importHunchlyCapture(second.ledger, payload, { ...context, deviceId: 'device-b' }); assert.equal(third.ledger.sources.length, 2);
});

test('Hunchly strict fields, reference consistency, source URLs and limits fail closed', async () => {
  const payload = { page: { case_id: 1, page_id: 1, hash: 'a'.repeat(64), timestamp_created: at, title: 'Synthetic', url: 'https://example.invalid/' } };
  await assert.rejects(importHunchlyCapture(fresh(), { ...payload, surprise: true }, { ...context, deviceId: 'fixture' }), hasCode('INVALID_SCHEMA'));
  await assert.rejects(importHunchlyCapture(fresh(), { ...payload, case_information: { case_id: 9 } }, { ...context, deviceId: 'fixture' }), hasCode('INVALID_SCHEMA'));
  const unsafe = clone(payload); unsafe.page.url = 'javascript:alert(1)';
  await assert.rejects(importHunchlyCapture(fresh(), unsafe, { ...context, deviceId: 'fixture' }), hasCode('INVALID_URL'));
  await assert.rejects(importHunchlyCapture(fresh(), { ...payload, data: new Array(501).fill({ data: 'x', data_extractor: 'fixture' }) }, { ...context, deviceId: 'fixture' }), hasCode('IMPORT_LIMIT'));
  await assert.rejects(importHunchlyCapture(fresh(), { ...payload, page_content: 'x'.repeat(512001) }, { ...context, deviceId: 'fixture' }), hasCode('IMPORT_LIMIT'));
  await assert.rejects(importHunchlyCapture(fresh(), JSON.stringify(payload).replace('"page":', '"__proto__":{},"page":'), { ...context, deviceId: 'fixture' }), hasCode('UNSAFE_KEY'));
});

test('portable bundle is complete, exact-byte verifiable, and honestly excludes original artifacts', async () => {
  const ledger = await fixture(); const bundle = await exportEvidenceBundle(ledger, { actor: 'fixture', generatedAt: at });
  assert.equal(bundle.files.length, 10); assert.equal(bundle.originalArtifactsIncluded, false);
  assert.equal((await verifyCaptureManifest(bundle.manifest, bundle.files)).ok, true);
  const notes = JSON.parse(bundle.files.find((file) => file.path === 'format-notes.json').bytes);
  assert.equal(notes.originalArtifactsIncluded, false); assert.ok(notes.stix.skipped.length);
  const altered = bundle.files.map((file) => file.path === 'report.md' ? { ...file, bytes: `${file.bytes}tampered` } : file);
  assert.equal((await verifyCaptureManifest(bundle.manifest, altered)).ok, false);
});
