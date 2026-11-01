/** Independent documented-format adapters. No vendor SDK/code, network, or credential access. */
import { EvidenceError, LIMITS, activeMatches, assertSafeData, attachCaptureManifest, buildGraph, canonicalJSON, createCaptureManifest, fail, ingestEvidence, normalizeEventTime, parseEvidenceJSON, safeJSONStringify, safeSourceURL, sha256, toBytes, validateLedger } from './evidence-core.mjs';

const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const byId = (rows) => [...rows].sort((a, b) => order(a.id, b.id));
const unique = (values) => [...new Set(values)].sort(order);
const plain = (value) => value === null ? 'unknown' : typeof value === 'string' ? value : JSON.stringify(value);
const xml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);
const markdown = (value) => plain(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\\`*_{}\[\]()#+!|]/g, '\\$&').replace(/\r?\n/g, ' ');
function strictObject(value, allowed, required = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_SCHEMA', 'Expected an object.');
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail('INVALID_SCHEMA', 'An unsupported format field is present.');
  for (const key of required) if (!Object.hasOwn(value, key)) fail('INVALID_SCHEMA', `Missing format field: ${key}.`);
}
function boundedText(value, label, max = 2000) {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) fail('INVALID_SCHEMA', `${label} must be bounded text.`);
  return value;
}
function natural(value, label) { if (!Number.isSafeInteger(value) || value < 0) fail('INVALID_SCHEMA', `${label} must be a nonnegative integer.`); return value; }

/** CSV cells are always quoted; formula prefixes are neutralized even behind whitespace. */
export function csvCell(value) {
  let cell = value === null || value === undefined ? '' : typeof value === 'string' ? value : String(value);
  if (/^[\s\u0000-\u001f]*[=+\-@]/u.test(cell) || /^[\t\r\n]/.test(cell)) cell = `'${cell}`;
  return `"${cell.replace(/"/g, '""')}"`;
}
function csv(rows) { return `${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`; }
export function exportCaseJSON(ledger) { validateLedger(ledger); return safeJSONStringify(ledger); }
export function exportCSV(ledger) {
  validateLedger(ledger);
  const rows = [['record_type', 'id', 'type', 'subject_id', 'predicate', 'value', 'object_id', 'source_id', 'event_time', 'event_precision', 'captured_at', 'evidence_ids', 'counterevidence_ids', 'review_status']];
  for (const entity of byId(ledger.entities)) rows.push(['entity', entity.id, entity.type, '', '', entity.label, '', '', '', '', '', '', '', '']);
  for (const observation of byId(ledger.observations)) rows.push(['observation', observation.id, '', observation.entityId, observation.property, plain(observation.value), '', observation.sourceId, observation.eventTime?.value ?? '', observation.eventTime?.precision ?? '', observation.capturedAt, '', '', 'source_assertion']);
  for (const claim of byId(ledger.claims)) rows.push(['claim', claim.id, '', claim.subjectId, claim.predicate, claim.objectId ? '' : plain(claim.value), claim.objectId ?? '', '', '', '', '', claim.evidenceIds.join(';'), claim.counterEvidenceIds.join(';'), claim.status]);
  for (const review of byId(ledger.reviews)) rows.push(['review', review.id, review.kind, review.leftId ?? review.claimId, 'manual_review', review.reason, review.rightId ?? '', '', '', '', review.at, review.evidenceIds.join(';'), review.counterEvidenceIds.join(';'), review.decision]);
  return csv(rows);
}
export function exportMarkdown(ledger) {
  validateLedger(ledger);
  const lines = [`# ${markdown(ledger.title)}`, '', `Case: ${markdown(ledger.caseId)}. This report separates source observations from reviewed claims.`, '', '## Source observations', '', '| Entity | Property | Source assertion | Event date | Captured | Source |', '| --- | --- | --- | --- | --- | --- |'];
  for (const row of byId(ledger.observations)) {
    const entity = ledger.entities.find((item) => item.id === row.entityId); const source = ledger.sources.find((item) => item.id === row.sourceId);
    lines.push(`| ${markdown(entity.label)} (${markdown(entity.id)}) | ${markdown(row.property)} | ${markdown(row.value)} | ${markdown(row.eventTime ? `${row.eventTime.value} (${row.eventTime.precision})` : 'unknown')} | ${markdown(row.capturedAt)} | ${markdown(source.label)}; ${markdown(source.url ?? 'no URL')}; observation ${markdown(row.id)} |`);
  }
  lines.push('', '## Claims and review', '');
  for (const claim of byId(ledger.claims)) lines.push(`- ${markdown(claim.id)}: ${markdown(claim.subjectId)} / ${markdown(claim.predicate)} / ${markdown(claim.objectId ?? claim.value)}. Status: ${markdown(claim.status)}. Supports: ${markdown(claim.evidenceIds.join(', '))}. Counterevidence: ${markdown(claim.counterEvidenceIds.join(', ') || 'none recorded')}.`);
  lines.push('', '## Manual decisions', '');
  for (const review of ledger.reviews) lines.push(`- ${markdown(review.id)}: ${markdown(review.kind)} ${markdown(review.decision)} by ${markdown(review.actor)} at ${markdown(review.at)}. Reason: ${markdown(review.reason)}. Supporting evidence: ${markdown(review.evidenceIds.join(', ') || 'none')}; counterevidence: ${markdown(review.counterEvidenceIds.join(', ') || 'none')}.`);
  lines.push('', '## Integrity and limitations', '', `Audit head: ${markdown(ledger.audit.at(-1)?.digest ?? 'no changes recorded')}. Preserve this checkpoint separately to detect later replacement.`, '', 'Source independence is an analyst declaration, not a verified count of independent corroboration. Digests establish byte consistency against a retained manifest; they do not prove source truth, capture authenticity or admissibility. Unknown event dates remain undated.', '');
  return lines.join('\n');
}

/** Maltego tabular-import mapping, not an undocumented native .mtgx format. */
export function exportMaltegoCSV(ledger) {
  validateLedger(ledger);
  const entities = [['EntityID', 'EntityType', 'Value', 'DisplayName', 'SemanticType', 'SourceURLs', 'ObservationIDs']];
  for (const entity of byId(ledger.entities)) {
    const observations = ledger.observations.filter((row) => row.entityId === entity.id);
    // Standard Person entities can match by name in the destination. A Phrase whose
    // identity is our stable ID keeps same-name source records distinct by default.
    entities.push([entity.id, 'maltego.Phrase', entity.id, entity.label, entity.type, unique(observations.map((row) => ledger.sources.find((source) => source.id === row.sourceId)?.url).filter(Boolean)).join(';'), observations.map((row) => row.id).sort(order).join(';')]);
  }
  const links = [['Source', 'Target', 'Label', 'ClaimID', 'EvidenceIDs', 'CounterEvidenceIDs', 'ReviewStatus']];
  for (const claim of byId(ledger.claims)) if (claim.objectId) links.push([claim.subjectId, claim.objectId, claim.predicate, claim.id, claim.evidenceIds.join(';'), claim.counterEvidenceIds.join(';'), claim.status]);
  for (const review of activeMatches(ledger)) links.push([review.leftId, review.rightId, 'same_identity_reviewed', review.id, review.evidenceIds.join(';'), review.counterEvidenceIds.join(';'), 'accepted']);
  return { entitiesCSV: csv(entities), linksCSV: csv(links), mapping: { entityId: 'EntityID', entityType: 'EntityType', value: 'Value', displayName: 'DisplayName', semanticType: 'SemanticType', sourceId: 'Source', targetId: 'Target', linkLabel: 'Label' }, integration: 'offline_tabular_format_only', warning: 'Import stable Value/EntityID as Phrase identity and preserve DisplayName/SemanticType as properties. This avoids default name matching; converting to standard Person types may merge records. CSV formula protection may prefix display values with an apostrophe. No vendor-client acceptance was exercised.' };
}
export function exportGEXF(ledger, options = {}) {
  const graph = buildGraph(ledger, options);
  const nodeAttributes = '<attributes class="node"><attribute id="kind" title="kind" type="string"/><attribute id="recordId" title="recordId" type="string"/></attributes>';
  const edgeAttributes = '<attributes class="edge"><attribute id="status" title="reviewStatus" type="string"/><attribute id="evidence" title="evidenceIds" type="string"/><attribute id="counterevidence" title="counterEvidenceIds" type="string"/></attributes>';
  const nodes = graph.nodes.map((node) => `<node id="${xml(node.id)}" label="${xml(node.label)}"><attvalues><attvalue for="kind" value="${xml(node.kind)}"/><attvalue for="recordId" value="${xml(node.recordId)}"/></attvalues></node>`).join('');
  const edges = graph.edges.map((edge) => `<edge id="${xml(edge.id)}" source="${xml(edge.source)}" target="${xml(edge.target)}" label="${xml(edge.type)}"><attvalues><attvalue for="status" value="${xml(edge.reviewStatus ?? '')}"/><attvalue for="evidence" value="${xml((edge.evidenceIds ?? []).join(';'))}"/><attvalue for="counterevidence" value="${xml((edge.counterEvidenceIds ?? []).join(';'))}"/></attvalues></edge>`).join('');
  return { xml: `<?xml version="1.0" encoding="UTF-8"?><gexf xmlns="http://gexf.net/1.3" version="1.3"><graph mode="static" defaultedgetype="directed">${nodeAttributes}${edgeAttributes}<nodes>${nodes}</nodes><edges>${edges}</edges></graph></gexf>`, truncated: graph.truncated, omittedNodes: graph.omittedNodes, omittedEdges: graph.omittedEdges };
}

/** A deliberately bounded FtM projection. Unmapped records remain in case JSON and are reported. */
export function exportFtM(ledger) {
  validateLedger(ledger);
  const allowed = new Set(['Person', 'Organization', 'Company', 'Document', 'Event']);
  const entities = []; const skipped = [];
  for (const entity of byId(ledger.entities)) {
    if (!allowed.has(entity.type)) { skipped.push({ id: entity.id, reason: 'No reviewed FtM schema mapping for this type.' }); continue; }
    const observations = ledger.observations.filter((row) => row.entityId === entity.id);
    const properties = { name: [entity.label], sourceUrl: unique(observations.map((row) => ledger.sources.find((source) => source.id === row.sourceId)?.url).filter(Boolean)), notes: [`Investigation entity ${entity.id}; observations are source assertions. See case JSON for conflicts, review status and counterevidence.`] };
    const permitted = new Set(['name', 'alias', 'summary', 'notes', 'description']);
    if (['Person', 'Organization', 'Company'].includes(entity.type)) for (const property of ['email', 'phone', 'website', 'address', 'leiCode']) permitted.add(property);
    if (['Organization', 'Company'].includes(entity.type)) permitted.add('registrationNumber');
    for (const observation of observations) {
      if (!permitted.has(observation.property) || typeof observation.value !== 'string') { skipped.push({ id: observation.id, reason: 'Observation property or value type is outside the bounded FtM mapping.' }); continue; }
      // Fields with type constraints are exported only after conservative syntax checks.
      if (observation.property === 'leiCode' && !/^[A-Z0-9]{20}$/.test(observation.value)) { skipped.push({ id: observation.id, reason: 'LEI syntax is invalid.' }); continue; }
      if (observation.property === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(observation.value)) { skipped.push({ id: observation.id, reason: 'Email syntax is invalid.' }); continue; }
      if (observation.property === 'website') { try { safeSourceURL(observation.value); } catch { skipped.push({ id: observation.id, reason: 'Website URL is invalid.' }); continue; } }
      properties[observation.property] = unique([...(properties[observation.property] ?? []), observation.value]);
    }
    entities.push({ id: entity.id, schema: entity.type, properties });
  }
  const exported = new Set(entities.map((row) => row.id));
  for (const claim of byId(ledger.claims)) {
    if (claim.status !== 'accepted' || claim.predicate !== 'owns' || !claim.objectId || !exported.has(claim.subjectId) || !exported.has(claim.objectId)) { skipped.push({ id: claim.id, reason: 'Only accepted owns relationships with mapped endpoints project to FtM Ownership.' }); continue; }
    const endpointTypes = [claim.subjectId, claim.objectId].map((ref) => ledger.entities.find((row) => row.id === ref).type);
    if (!['Person', 'Company', 'Organization'].includes(endpointTypes[0]) || !['Company', 'Organization'].includes(endpointTypes[1])) { skipped.push({ id: claim.id, reason: 'Ownership endpoints are outside the bounded mapping.' }); continue; }
    const observations = claim.evidenceIds.map((ref) => ledger.observations.find((row) => row.id === ref));
    entities.push({ id: claim.id, schema: 'Ownership', properties: { owner: [claim.subjectId], asset: [claim.objectId], sourceUrl: unique(observations.map((row) => ledger.sources.find((source) => source.id === row.sourceId)?.url).filter(Boolean)), summary: [`Manually accepted claim ${claim.id}. Counterevidence IDs: ${claim.counterEvidenceIds.join(', ') || 'none recorded'}.`] } });
  }
  return { entities, ndjson: entities.map((entity) => safeJSONStringify(entity, 0)).join('\n') + (entities.length ? '\n' : ''), skipped, warning: 'Bounded FollowTheMoney projection. Full source assertions, review history and artifact hashes remain in case JSON/PROV export; this is not an OCCRP service or KYC clearance.' };
}

/** PROV-JSON follows the W3C Member Submission, not a claim of W3C certification. */
export function exportPROV(ledger) {
  validateLedger(ledger);
  const q = (kind, value) => `case:${kind}_${encodeURIComponent(value)}`;
  const document = { prefix: { prov: 'http://www.w3.org/ns/prov#', xsd: 'http://www.w3.org/2001/XMLSchema#', case: 'urn:osint-evidence:' }, entity: {}, activity: {}, agent: {}, wasDerivedFrom: {}, wasGeneratedBy: {}, wasAssociatedWith: {} };
  for (const source of ledger.sources) document.entity[q('source', source.id)] = { 'prov:label': source.label, 'case:kind': 'source', 'case:sourceURL': source.url ?? '', 'case:independence': source.independence, 'case:originGroup': source.independenceGroup ?? 'unknown' };
  for (const entity of ledger.entities) document.entity[q('entity', entity.id)] = { 'prov:label': entity.label, 'case:kind': entity.type };
  for (const observation of ledger.observations) {
    document.entity[q('observation', observation.id)] = { 'prov:label': observation.property, 'case:value': plain(observation.value), 'case:subject': q('entity', observation.entityId), 'case:capturedAt': observation.capturedAt, ...(observation.eventTime ? { 'case:eventTime': observation.eventTime.value, 'case:eventPrecision': observation.eventTime.precision } : {}) };
    document.wasDerivedFrom[q('derivation', observation.id)] = { 'prov:generatedEntity': q('observation', observation.id), 'prov:usedEntity': q('source', observation.sourceId) };
    if (observation.artifactId) document.wasDerivedFrom[q('artifact_derivation', observation.id)] = { 'prov:generatedEntity': q('observation', observation.id), 'prov:usedEntity': q('artifact', observation.artifactId) };
  }
  for (const claim of ledger.claims) {
    document.entity[q('claim', claim.id)] = { 'prov:label': claim.predicate, 'case:status': claim.status, 'case:subject': q('entity', claim.subjectId), 'case:object': claim.objectId ? q('entity', claim.objectId) : plain(claim.value), ...(claim.counterEvidenceIds.length ? { 'case:counterEvidence': claim.counterEvidenceIds.map((ref) => q('observation', ref)) } : {}) };
    for (const ref of claim.evidenceIds) document.wasDerivedFrom[q('support', `${claim.id}_${ref}`)] = { 'prov:generatedEntity': q('claim', claim.id), 'prov:usedEntity': q('observation', ref) };
  }
  for (const artifact of ledger.artifacts) document.entity[q('artifact', artifact.id)] = { 'prov:label': 'Capture bundle manifest', 'case:sha256': artifact.manifest.digest, 'case:fileHashes': artifact.manifest.files.map((file) => `${file.path}:${file.sha256}`) };
  for (const review of ledger.reviews) document.entity[q('review', review.id)] = { 'prov:label': `${review.kind} ${review.decision}`, 'case:reason': review.reason, 'case:decision': review.decision, 'case:subject': review.claimId ? q('claim', review.claimId) : q('entity', review.leftId), ...(review.rightId ? { 'case:object': q('entity', review.rightId) } : {}), ...(review.counterEvidenceIds.length ? { 'case:counterEvidence': review.counterEvidenceIds.map((ref) => q('observation', ref)) } : {}) };
  const actors = unique(ledger.audit.map((entry) => entry.actor));
  for (const [index, actor] of actors.entries()) document.agent[`case:actor_${index + 1}`] = { 'prov:label': actor };
  for (const entry of ledger.audit) {
    const activity = q('audit', entry.id);
    document.activity[activity] = { 'prov:label': entry.action, 'prov:startTime': entry.at, 'prov:endTime': entry.at, 'case:sha256': entry.digest, 'case:snapshotSha256': entry.snapshotDigest, ...(entry.previousDigest ? { 'case:previousSha256': entry.previousDigest } : {}) };
    document.wasAssociatedWith[q('association', entry.id)] = { 'prov:activity': activity, 'prov:agent': `case:actor_${actors.indexOf(entry.actor) + 1}` };
    for (const ref of entry.details.observationIds ?? []) document.wasGeneratedBy[q('generation', ref)] = { 'prov:entity': q('observation', ref), 'prov:activity': activity, 'prov:time': entry.at };
    if (entry.details.reviewId) document.wasGeneratedBy[q('review_generation', entry.details.reviewId)] = { 'prov:entity': q('review', entry.details.reviewId), 'prov:activity': activity, 'prov:time': entry.at };
  }
  return document;
}

function ipv4(value) { return typeof value === 'string' && value.split('.').length === 4 && value.split('.').every((part) => /^(0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255); }
function ipValue(value) {
  if (ipv4(value)) return { type: 'ipv4-addr', value };
  if (typeof value === 'string' && /^[0-9a-fA-F:]+$/.test(value) && value.includes(':')) {
    try { const host = new URL(`http://[${value}]/`).hostname; return { type: 'ipv6-addr', value: host.slice(1, -1) }; } catch { return null; }
  }
  return null;
}
function scoFor(entity, observation) {
  if (typeof observation.value !== 'string' || !['value', 'address', 'domain', 'url', 'email', 'sha256'].includes(observation.property)) return null;
  const value = observation.value;
  if (entity.type === 'IPAddress') return ipValue(value);
  if (entity.type === 'Domain' && value.length <= 253 && value.split('.').length >= 2 && value.split('.').every((label) => /^(?!-)[a-zA-Z0-9-]{1,63}(?<!-)$/.test(label))) return { type: 'domain-name', value: value.toLowerCase() };
  if (entity.type === 'EmailAddress' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return { type: 'email-addr', value };
  if (entity.type === 'URL') { try { return { type: 'url', value: safeSourceURL(value) }; } catch { return null; } }
  if (entity.type === 'File' && observation.property === 'sha256' && /^[a-fA-F0-9]{64}$/.test(value)) return { type: 'file', hashes: { 'SHA-256': value.toLowerCase() } };
  return null;
}
async function scoId(sco) {
  // STIX 2.1's defined SCO UUIDv5 namespace and ID-contributing properties.
  const namespace = '00abedb4aa42466c9c01fed23315a9b7';
  const prefix = Uint8Array.from(namespace.match(/../g).map((hex) => parseInt(hex, 16)));
  const contributing = new TextEncoder().encode(canonicalJSON(sco.hashes ? { hashes: sco.hashes } : { value: sco.value }));
  const input = new Uint8Array(prefix.length + contributing.length); input.set(prefix); input.set(contributing, prefix.length);
  if (!globalThis.crypto?.subtle) fail('CRYPTO_UNAVAILABLE', 'Web Crypto is required for STIX identifiers.');
  const bytes = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-1', input)).slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50; bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${sco.type}--${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export async function exportSTIX(ledger, { generatedAt = new Date().toISOString() } = {}) {
  validateLedger(ledger);
  const generated = normalizeEventTime(generatedAt);
  if (generated?.precision !== 'timestamp') fail('INVALID_DATE', 'STIX creation time requires a timestamp.');
  if (!globalThis.crypto?.randomUUID) fail('CRYPTO_UNAVAILABLE', 'Web Crypto UUID generation is required.');
  const objects = []; const seen = new Set(); const skipped = [];
  for (const observation of byId(ledger.observations)) {
    const entity = ledger.entities.find((row) => row.id === observation.entityId);
    const sco = scoFor(entity, observation);
    if (!sco) { skipped.push({ id: observation.id, reason: 'Not an explicitly typed supported cyber observable.' }); continue; }
    if (observation.eventTime?.precision !== 'timestamp') { skipped.push({ id: observation.id, reason: 'A precise observation event timestamp is required; retrieval time and date-only precision are not substituted.' }); continue; }
    const objectId = await scoId(sco);
    if (!seen.has(objectId)) { objects.push({ ...sco, spec_version: '2.1', id: objectId }); seen.add(objectId); }
    const source = ledger.sources.find((row) => row.id === observation.sourceId);
    objects.push({ type: 'observed-data', spec_version: '2.1', id: `observed-data--${globalThis.crypto.randomUUID()}`, created: generated.value, modified: generated.value, first_observed: observation.eventTime.value, last_observed: observation.eventTime.value, number_observed: 1, object_refs: [objectId], external_references: [{ source_name: source.provider ?? source.label, external_id: observation.id, ...(source.url ? { url: source.url } : {}) }] });
  }
  return { bundle: { type: 'bundle', id: `bundle--${globalThis.crypto.randomUUID()}`, objects }, skipped, warning: 'Only explicit supported cyber observations with event timestamps are projected. Person/Organization/identity claims and analyst probabilities are not SCOs. Full review and custody data remain in case JSON/PROV.' };
}

/** Documented Hunchly Data Forwarding payload. This imports files; it never calls Hunchly. */
export async function importHunchlyCapture(ledger, input, { actor, deviceId, mhtmlBytes, at = new Date().toISOString() } = {}) {
  validateLedger(ledger);
  const payload = parseEvidenceJSON(input, { maxBytes: 1024 * 1024, maxString: 512000, maxNodes: 10000 });
  strictObject(payload, ['javascript', 'page_content', 'case_information', 'data', 'page', 'photos'], ['page']);
  if (typeof deviceId !== 'string' || !/^[A-Za-z0-9._-]{1,48}$/.test(deviceId)) fail('INVALID_ID', 'A stable local device namespace is required.');
  const page = payload.page;
  strictObject(page, ['case_id', 'hash', 'page_id', 'timestamp_created', 'timestamp_updated', 'title', 'url'], ['case_id', 'hash', 'page_id', 'timestamp_created', 'title', 'url']);
  natural(page.case_id, 'Hunchly case ID'); natural(page.page_id, 'Hunchly page ID');
  if (typeof page.hash !== 'string' || !/^[a-fA-F0-9]{64}$/.test(page.hash)) fail('INVALID_HASH', 'Hunchly requires a declared MHTML SHA-256.');
  const declaredHash = page.hash.toLowerCase(); const captureTime = normalizeEventTime(page.timestamp_created);
  if (captureTime?.precision !== 'timestamp') fail('INVALID_DATE', 'Hunchly capture time requires a timestamp.');
  if (page.timestamp_updated !== undefined) normalizeEventTime(page.timestamp_updated);
  const title = boundedText(page.title, 'Capture title', 500) || 'Untitled Hunchly capture'; const url = safeSourceURL(page.url);
  if (!url) fail('INVALID_URL', 'Hunchly capture URL is required.');
  if (payload.page_content !== undefined) boundedText(payload.page_content, 'Captured HTML', 512000);
  if (payload.javascript !== undefined) boundedText(payload.javascript, 'Extracted JavaScript', 128000);
  if (payload.case_information !== undefined) {
    strictObject(payload.case_information, ['case_id', 'case_name', 'case_reference', 'case_information']);
    if (payload.case_information.case_id !== undefined && payload.case_information.case_id !== page.case_id) fail('INVALID_SCHEMA', 'Hunchly case IDs disagree.');
    for (const field of ['case_name', 'case_reference']) if (payload.case_information[field] !== undefined) boundedText(payload.case_information[field], field, 500);
    if (payload.case_information.case_information !== undefined) {
      if (!payload.case_information.case_information || typeof payload.case_information.case_information !== 'object' || Array.isArray(payload.case_information.case_information) || Object.keys(payload.case_information.case_information).length > 30) fail('IMPORT_LIMIT', 'Hunchly case metadata exceeds the limit.');
      for (const [key, value] of Object.entries(payload.case_information.case_information)) { boundedText(key, 'Case metadata key', 100); boundedText(value, 'Case metadata value', 1000); }
    }
  }
  if (payload.photos !== undefined) {
    if (!Array.isArray(payload.photos) || payload.photos.length > 200) fail('IMPORT_LIMIT', 'Photo metadata exceeds the limit.');
    for (const photo of payload.photos) {
      strictObject(photo, ['photo_hash', 'photo_url', 'exif'], ['photo_hash', 'photo_url']);
      if (typeof photo.photo_hash !== 'string' || !/^[a-fA-F0-9]{64}$/.test(photo.photo_hash)) fail('INVALID_HASH', 'Photo SHA-256 is invalid.');
      safeSourceURL(photo.photo_url);
      if (photo.exif != null && (typeof photo.exif !== 'object' || Array.isArray(photo.exif) || Object.keys(photo.exif).length > 100)) fail('IMPORT_LIMIT', 'EXIF metadata exceeds the limit.');
    }
  }
  const data = payload.data ?? [];
  if (!Array.isArray(data) || data.length > 500) fail('IMPORT_LIMIT', 'Hunchly extracted values exceed the limit.');
  for (const row of data) { strictObject(row, ['data', 'data_extractor', 'data_type'], ['data', 'data_extractor']); boundedText(row.data, 'Extracted value', 4000); boundedText(row.data_extractor, 'Extractor', 100); if (row.data_type !== undefined) boundedText(row.data_type, 'Extraction type', 100); }
  const files = [];
  if (payload.page_content !== undefined) files.push({ path: 'capture.html', bytes: payload.page_content, mediaType: 'text/html', sourceUrl: url, capturedAt: captureTime.value });
  let originalBytesVerified = false;
  if (mhtmlBytes !== undefined) {
    const bytes = toBytes(mhtmlBytes);
    if (await sha256(bytes) !== declaredHash) fail('MHTML_HASH_MISMATCH', 'Original MHTML bytes do not match the declared Hunchly hash.');
    originalBytesVerified = true;
    files.push({ path: 'original.mhtml', bytes, mediaType: 'multipart/related', sourceUrl: url, capturedAt: captureTime.value });
  }
  const sourceId = `hunchly:${deviceId}:${page.case_id}:${page.page_id}:${declaredHash.slice(0, 16)}`;
  const entityId = `doc:${sourceId}`;
  let next = ledger; let artifactId = null; let manifest = null;
  if (files.length) {
    manifest = await createCaptureManifest(files, { actor, capturedAt: captureTime.value, sourceUrl: url });
    artifactId = `artifact-${manifest.digest}`;
    next = await attachCaptureManifest(next, manifest, { actor, at });
  }
  const observations = [{ entityId, property: 'title', value: title }, { entityId, property: 'url', value: url }, { entityId, property: 'hunchly.declared_mhtml_sha256', value: declaredHash }, ...data.map((row) => ({ entityId, property: `extractor:${row.data_extractor}`, value: row.data }))].map((row) => ({ ...row, capturedAt: captureTime.value, eventTime: null, artifactId }));
  next = await ingestEvidence(next, { source: { id: sourceId, label: `Hunchly capture: ${title}`, url, provider: 'hunchly-import', independence: 'unknown' }, entities: [{ id: entityId, type: 'Document', label: title }], observations }, { actor, at });
  return { ledger: next, capture: { sourceId, entityId, artifactId, declaredMhtmlSha256: declaredHash, originalBytesVerified, manifest }, integration: { format: 'hunchly-data-forwarding-json', fixtureFormatSupported: true, vendorConnectionVerified: false, mode: 'offline_import' }, warnings: [...(!originalBytesVerified ? ['Original MHTML bytes were not supplied: the Hunchly-declared hash is recorded but not verified. Forwarded HTML bytes have a separate hash.'] : []), 'Capture time is not an event date; imported observations remain undated.', ...(payload.javascript ? ['Extracted JavaScript is not executed or imported as active content.'] : [])] };
}

/** A complete portable file bundle descriptor; callers deliver files using their existing UI/storage. */
export async function exportEvidenceBundle(ledger, { actor, generatedAt = new Date().toISOString() } = {}) {
  validateLedger(ledger);
  const maltego = exportMaltegoCSV(ledger); const ftm = exportFtM(ledger); const gexf = exportGEXF(ledger); const stix = await exportSTIX(ledger, { generatedAt });
  const files = [
    { path: 'case.json', bytes: exportCaseJSON(ledger), mediaType: 'application/json' },
    { path: 'report.md', bytes: exportMarkdown(ledger), mediaType: 'text/markdown' },
    { path: 'observations.csv', bytes: exportCSV(ledger), mediaType: 'text/csv' },
    { path: 'maltego/entities.csv', bytes: maltego.entitiesCSV, mediaType: 'text/csv' },
    { path: 'maltego/links.csv', bytes: maltego.linksCSV, mediaType: 'text/csv' },
    { path: 'followthemoney.ndjson', bytes: ftm.ndjson, mediaType: 'application/x-ndjson' },
    { path: 'graph.gexf', bytes: gexf.xml, mediaType: 'application/xml' },
    { path: 'provenance.json', bytes: safeJSONStringify(exportPROV(ledger)), mediaType: 'application/json' },
    { path: 'stix.json', bytes: safeJSONStringify(stix.bundle), mediaType: 'application/stix+json' },
    { path: 'format-notes.json', bytes: safeJSONStringify({ maltego: { mapping: maltego.mapping, warning: maltego.warning }, ftm: { skipped: ftm.skipped, warning: ftm.warning }, graph: { truncated: gexf.truncated, omittedNodes: gexf.omittedNodes, omittedEdges: gexf.omittedEdges }, stix: { skipped: stix.skipped, warning: stix.warning }, originalArtifactsIncluded: false, limitation: 'This export contains artifact manifests, not the original captured files. Supply and verify originals separately.' }), mediaType: 'application/json' },
  ];
  const manifest = await createCaptureManifest(files, { actor, capturedAt: generatedAt });
  return { files, manifest, integration: 'offline_documented_formats', originalArtifactsIncluded: false };
}
