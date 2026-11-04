import fs from 'node:fs';
import path from 'node:path';

export const preparationFiles = [
  'source-audit.sql', 'integrity-check.sql', 'admin-read-guard.sql', 'target-preflight.sql',
  'post-restore-invitation-hardening.sql', 'post-restore-invitation-rpc.sql',
  'post-restore-stored-alerts.sql', 'stored-alerts-acceptance.rollback.sql',
  'stored-alerts-hash-vectors.rollback.sql', 'activate-stored-alerts-cron.sql',
  'stored-alerts-concurrency.session-A.sql', 'stored-alerts-concurrency.session-B.sql',
];

// Version 2 hashes canonical UTF-8 text. Only CRLF is normalized; other changes
// still fail integrity checks. Version 1 remains strictly byte hashed.
export function canonicalTextBytes(bytes) {
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  return Buffer.from(text.replaceAll('\r\n', '\n'), 'utf8');
}

export function checkedSource(app, relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.split(/[\\/]/).some(p => p === '..' || !p)) throw new Error('Unsafe source path');
  let file = path.resolve(app);
  for (const part of relative.split(/[\\/]/)) {
    file = path.join(file, part);
    if (fs.lstatSync(file).isSymbolicLink()) throw new Error('Symlink found in source snapshot; review it separately');
  }
  if (!fs.statSync(file).isFile()) throw new Error('Expected a source file');
  return file;
}

export function sourcePairs(app) {
  const pairs = [];
  function add(source, destination) { checkedSource(app, source); pairs.push({ source, path: destination }); }
  const migrations = fs.readdirSync(path.join(app, 'supabase/migrations')).filter(n => n.endsWith('.sql')).sort();
  if (!migrations.length || migrations.some(n => !/^\d{14}_[a-zA-Z0-9_-]+\.sql$/.test(n))) throw new Error('Missing or unrecognized migration filename requires review');
  for (const name of migrations) add(`supabase/migrations/${name}`, `migrations/${name}`);
  function walk(relative) {
    for (const entry of fs.readdirSync(path.join(app, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      if (entry.isSymbolicLink()) throw new Error('Symlink found in source snapshot; review it separately');
      const name = `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(name);
      else if (/\.(?:ts|js|json|toml|lock)$/.test(entry.name) && !/(?:_test|\.test|\.spec)\./.test(entry.name) && !entry.name.startsWith('.')) add(name, name.replace(/^supabase\//, ''));
    }
  }
  walk('supabase/functions');
  for (const entry of fs.readdirSync(path.join(app, 'supabase/functions'), { withFileTypes: true })) {
    if (entry.isDirectory() && !entry.name.startsWith('_')) checkedSource(app, `supabase/functions/${entry.name}/index.ts`);
  }
  add('supabase/config.toml', 'reference/source-config.toml');
  add('src/integrations/supabase/types.ts', 'reference/source-types.ts');
  for (const name of preparationFiles) add(`migration/lovable-exit/${name}`, name);
  return pairs.sort((a, b) => a.path.localeCompare(b.path, 'en'));
}
