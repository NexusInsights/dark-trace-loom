import { jsPDF } from 'jspdf';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const root = path.resolve(import.meta.dirname, '..');
const dir = path.join(root, 'deployment-evidence/marketplace-file-proof');
try {
  await fs.mkdir(dir, { recursive: true });
  const pdf = new jsPDF();
  pdf.setProperties({ title: 'Marketplace Parser Acceptance Evidence', author: 'Insight Nexus verification', subject: 'Generated test document; no claimed personal identity or original authorship evidence' });
  pdf.text('Actual PDF parser acceptance file. Generated for verification.', 12, 20);
  const bytes = Buffer.from(pdf.output('arraybuffer'));
  await fs.writeFile(path.join(dir, 'parser-acceptance.pdf'), bytes);
  const started = new Date(); const before = performance.now();
  const url = 'https://dns.google/resolve?name=example.com&type=A';
  const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`DNS evidence capture returned HTTP ${response.status}`);
  const body = await response.text(); const elapsed = performance.now() - before;
  JSON.parse(body);
  const har = { log: { version: '1.2', creator: { name: 'Insight Nexus actual fetch capture', version: '1' }, entries: [{ startedDateTime: started.toISOString(), time: elapsed, request: { method: 'GET', url, httpVersion: 'unknown', headers: [{ name: 'Accept', value: 'application/json' }], queryString: [...new URL(url).searchParams].map(([name,value]) => ({name,value})), cookies: [], headersSize: -1, bodySize: 0 }, response: { status: response.status, statusText: response.statusText, httpVersion: 'unknown', headers: [...response.headers].map(([name,value]) => ({name,value})), cookies: [], content: { size: Buffer.byteLength(body), mimeType: response.headers.get('content-type'), text: body }, redirectURL: '', headersSize: -1, bodySize: Buffer.byteLength(body) }, cache: {}, timings: { send: -1, wait: -1, receive: -1 }, comment: 'Total fetch duration was measured. Individual transport phases, protocol version and server address were not observed and remain unknown. This contains an actual provider response, no auth/cookie headers.' }] } };
  await fs.writeFile(path.join(dir, 'actual-dns-capture.har'), JSON.stringify(har, null, 2));
  const proof = { pdf: { filename: 'parser-acceptance.pdf', sha256: createHash('sha256').update(bytes).digest('hex'), size_bytes: bytes.length }, har: { filename: 'actual-dns-capture.har', source: url, http_status: response.status, body_bytes: Buffer.byteLength(body), measured_duration_ms: elapsed, created_at: started.toISOString() } };
  await fs.writeFile(path.join(dir, 'expected.json'), JSON.stringify(proof, null, 2));
  console.log(JSON.stringify(proof));
} catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
