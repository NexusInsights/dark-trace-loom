import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const runtimePaths = ['src', 'functions', 'supabase/functions', 'services', 'monitor-worker/src', 'ai-worker/src', 'public', '.github/workflows'];
const buildFiles = ['package.json', 'package-lock.json', 'vite.config.ts', 'index.html', 'wrangler.jsonc', 'monitor-worker/wrangler.jsonc', 'ai-worker/wrangler.jsonc'];
const textFile = /\.(?:[cm]?js|jsx|tsx?|jsonc?|html|css|toml|ya?ml)$/i;
const fixturePath = /(?:^|\/)(?:test|tests|__tests__)(?:\/|$)|\.(?:test|spec)\./i;
const builderHost = '(?:lovable\\.dev|lovable\\.app|lovableproject\\.com|lovableproject-dev\\.com|gptengineer\\.app|gptengineer\\.run|gpt-eng\\.com)';

// This static check detects concrete runtime/build integrations. It does not
// establish ownership of a separately hosted database, Auth service or storage.
export function builderDependencyFindings(source, filename) {
  const normalized = source.replace(/\\\//g, '/').replace(/\\(?:u002f|x2f)/gi, '/');
  const excluded = new RegExp('(?:^|\\.)' + builderHost + '$', 'i');
  let endpoint;
  for (const match of normalized.matchAll(/(?:https?:)?\/\/[^\s"'`<>\\)]+/gi)) {
    try {
      const url = new URL(match[0].startsWith('//') ? `https:${match[0]}` : match[0]);
      if (excluded.test(url.hostname.replace(/\.+$/, ''))) { endpoint = match; break; }
    } catch { /* Not a complete literal URL; this static check makes no runtime claim. */ }
  }
  const rules = [
    ['builder-auth-broker', /lovable-preview-auth:|\/~oauth\/initiate/i],
    ['builder-credential-configuration', /\b(?:LOVABLE_API_KEY|VITE_LOVABLE_[A-Z0-9_]+)\b/],
    ['builder-sdk', /["'](?:@lovable(?:\.dev)?\/[^"']+|lovable-tagger)["']/i],
  ];
  const endpoints = endpoint ? [{ file: filename, line: normalized.slice(0, endpoint.index).split('\n').length, rule: 'builder-endpoint' }] : [];
  return [...endpoints, ...rules.flatMap(([rule, expression]) => {
    const match = expression.exec(normalized);
    return match ? [{ file: filename, line: normalized.slice(0, match.index).split('\n').length, rule }] : [];
  })];
}

export function verifyBuilderIndependence(root, artifactDirectory) {
  const files = new Set();
  function visit(relative, required = false) {
    const full = path.resolve(root, relative);
    if (!fs.existsSync(full)) {
      if (required) throw new Error(`Required build input is missing: ${relative}`);
      return;
    }
    const stat = fs.lstatSync(full);
    if (stat.isSymbolicLink()) throw new Error(`Cannot attest a symlinked build input: ${relative}`);
    if (stat.isDirectory()) {
      for (const child of fs.readdirSync(full).sort()) visit(path.join(relative, child));
    } else if (textFile.test(full) && !fixturePath.test(relative.split(path.sep).join('/'))) files.add(relative);
  }
  runtimePaths.forEach(relative => visit(relative));
  buildFiles.forEach(relative => visit(relative, ['package.json', 'package-lock.json', 'vite.config.ts', 'index.html'].includes(relative)));
  if (artifactDirectory) {
    const relative = path.relative(root, path.resolve(root, artifactDirectory));
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('Build artifact must remain inside the project directory.');
    if (!fs.existsSync(path.join(root, relative, 'index.html'))) throw new Error('Build artifact index.html is missing.');
    visit(relative, true);
  }
  const findings = [...files].sort().flatMap(filename => builderDependencyFindings(fs.readFileSync(path.join(root, filename), 'utf8'), filename.split(path.sep).join('/')));
  return { passed: findings.length === 0, files: files.size, artifactChecked: Boolean(artifactDirectory), findings, scope: 'Static runtime/build integration check only; backend ownership and live services require separate verification.' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== '--artifact')) throw new Error('Usage: node scripts/verify-builder-independence.mjs [--artifact dist]');
    const result = verifyBuilderIndependence(path.resolve(import.meta.dirname, '..'), args[1]);
    console.log(JSON.stringify(result));
    if (!result.passed) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Builder dependency verification failed.');
    process.exitCode = 1;
  }
}
