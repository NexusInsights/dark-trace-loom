import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { canonicalTextBytes, checkedSource, sourcePairs } from './bundle-sources.mjs';

const taskDir = path.dirname(fileURLToPath(import.meta.url));
let dir = path.join(taskDir, 'bundle');
let sourceRoot = path.resolve(taskDir, '../..');
let integrityOnly = false;
const seenArgs = new Set();
try {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (seenArgs.has(flag)) throw new Error('Duplicate verification option');
    seenArgs.add(flag);
    if (flag === '--integrity-only') integrityOnly = true;
    else if (['--bundle', '--source-root'].includes(flag) && args[i + 1] && !args[i + 1].startsWith('--')) {
      if (flag === '--bundle') dir = path.resolve(args[++i]); else sourceRoot = path.resolve(args[++i]);
    } else throw new Error('Usage: node verify-bundle.mjs [--bundle DIRECTORY] [--source-root APP_DIRECTORY] [--integrity-only]');
  }
  if (integrityOnly && seenArgs.has('--source-root')) throw new Error('Integrity-only verification cannot claim current-source freshness');
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  if (![1, 2].includes(manifest.format_version) || !Array.isArray(manifest.files) || !manifest.files.length) throw new Error('Invalid migration manifest');
  if (manifest.format_version === 2 && manifest.text_encoding !== 'utf8-lf') throw new Error('Unknown bundle text encoding');
  const bytesFor = bytes => manifest.format_version === 2 ? canonicalTextBytes(bytes) : bytes;
  const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  const realDir = fs.realpathSync(dir);
  const seen = new Set();
  for (const entry of manifest.files) {
    if (typeof entry.path !== 'string' || seen.has(entry.path) || path.isAbsolute(entry.path) || entry.path.includes(String.fromCharCode(92)) || entry.path.split('/').some(p => p === '..' || !p)) throw new Error('Unsafe or duplicate manifest path');
    seen.add(entry.path);
    const full = checkedSource(realDir, entry.path);
    const bytes = bytesFor(fs.readFileSync(full));
    if (bytes.length !== entry.bytes || hash(bytes) !== entry.sha256) throw new Error(`Bundle integrity mismatch: ${entry.path}`);
  }
  function actualFiles(base) {
    return fs.readdirSync(base, { withFileTypes: true }).flatMap(item => {
      const full = path.join(base, item.name);
      if (item.isSymbolicLink()) throw new Error('Symlinks are not allowed in the bundle');
      return item.isDirectory() ? actualFiles(full) : [path.relative(dir, full).split(path.sep).join('/')];
    });
  }
  for (const filename of actualFiles(dir)) if (filename !== 'manifest.json' && !seen.has(filename)) throw new Error(`Unlisted bundle file requires review: ${filename}`);
  if (!Array.isArray(manifest.migration_order) || !manifest.migration_order.length) throw new Error('Missing migration order');
  const ordered = [...manifest.migration_order].sort();
  if (JSON.stringify(ordered) !== JSON.stringify(manifest.migration_order) || new Set(ordered).size !== ordered.length) throw new Error('Migration order is not deterministic');
  const inventory = JSON.parse(fs.readFileSync(path.join(dir, 'inventory.json'), 'utf8'));
  if (inventory.migration_count !== ordered.length) throw new Error('Inventory/migration count mismatch');
  const replay = fs.readFileSync(path.join(dir, 'schema-replay.sql'), 'utf8');
  if (!replay.includes('app.lovable_exit_target_confirmed') || !replay.includes('Existing public application relations') || !replay.includes('auth.users') || !replay.includes('dbdkvrkmeowdydizrsmn') || !replay.startsWith('-- FRESH EMPTY TARGET ONLY.') || !replay.trimEnd().endsWith('COMMIT;')) throw new Error('Fresh-target guards are missing');
  let offset = -1;
  for (const migration of ordered) {
    const index = replay.indexOf(`-- Source migration: ${migration}`);
    if (index <= offset || !seen.has(`migrations/${migration}`)) throw new Error('Replay migration ordering mismatch');
    offset = index;
  }
  if (!integrityOnly) {
    const expected = sourcePairs(sourceRoot);
    const recorded = manifest.files.filter(row => row.source !== 'generated local preparation');
    const identity = rows => rows.map(row => JSON.stringify([row.source, row.path])).sort();
    if (JSON.stringify(identity(recorded)) !== JSON.stringify(identity(expected))) throw new Error('Bundle source inventory is stale: added, removed or omitted source files require a fresh snapshot');
    const generated = manifest.files.filter(row => row.source === 'generated local preparation').map(row => row.path).sort();
    if (JSON.stringify(generated) !== JSON.stringify(['inventory.json', 'row-counts-and-id-digests.sql', 'schema-replay.sql'])) throw new Error('Unexpected generated bundle inventory');
    for (const entry of recorded) {
      const bytes = bytesFor(fs.readFileSync(checkedSource(sourceRoot, entry.source)));
      if (bytes.length !== entry.bytes || hash(bytes) !== entry.sha256) throw new Error(`Bundle source changed: ${entry.source}`);
    }
  }
  console.log(JSON.stringify({ verified: true, files: manifest.files.length, migrations: ordered.length, public_tables: inventory.public_tables.length, edge_functions: inventory.edge_function_directories.length, source_freshness_verified: !integrityOnly, database_actions: 0, notice: integrityOnly ? 'Historical integrity only; current-source freshness was not checked. No migration or deployment acceptance.' : 'Local integrity and current-source freshness only; no SQL, deployment or production-data acceptance.' }));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Bundle verification failed');
  process.exitCode = 1;
}
