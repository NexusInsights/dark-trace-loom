import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function argumentsFor(argv, permitted) {
  const values = {};
  for (let i = 0; i < argv.length; i += 2) {
    const option = argv[i];
    if (!permitted.includes(option) || Object.hasOwn(values, option) || !argv[i + 1] || argv[i + 1].startsWith('--'))
      throw new Error('Provide each documented option exactly once, with an explicit value. Use --help for usage.');
    values[option] = argv[i + 1];
  }
  for (const option of permitted) if (!values[option]) throw new Error(`Missing required option ${option}. No files were changed.`);
  return values;
}

export function secureOrigin(value, description) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${description} must be a valid HTTPS origin.`); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/' || url.port)
    throw new Error(`${description} must be an HTTPS origin without credentials, path, query, fragment or nonstandard port.`);
  return url.origin;
}

export function publicBackend(urlValue, key, expectedRef, declaredRef) {
  if (!/^[a-z0-9]{20}$/.test(expectedRef)) throw new Error('Expected project ref must contain exactly 20 lowercase letters or digits.');
  const url = secureOrigin(urlValue, 'Public backend URL');
  if (new URL(url).hostname !== `${expectedRef}.supabase.co`) throw new Error('Public backend origin does not match the expected project ref.');
  if (declaredRef && declaredRef !== expectedRef) throw new Error('Declared project ID does not match the expected project ref.');
  if (typeof key !== 'string' || !key || /\s/.test(key)) throw new Error('A valid public backend key is required.');
  if (key.startsWith('sb_publishable_')) {
    if (!/^sb_publishable_[A-Za-z0-9_-]{16,256}$/.test(key)) throw new Error('Public publishable key has an invalid format.');
    return { url, key, ref: expectedRef, keyType: 'publishable' };
  }
  let payload, header;
  try {
    const parts = key.split('.');
    if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) throw new Error('Invalid key encoding');
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch { throw new Error('Only a public publishable key or a legacy anon JWT may be used.'); }
  if (header?.alg !== 'HS256' || payload?.role !== 'anon') throw new Error('Privileged, secret or non-anon keys are prohibited in public configuration.');
  if (payload.ref !== expectedRef) throw new Error('Legacy anon key belongs to a different project ref.');
  if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp) || payload.exp <= Date.now() / 1000)
    throw new Error('Legacy anon key is expired or has an invalid expiry.');
  return { url, key, ref: expectedRef, keyType: 'legacy_anon' };
}

export function publicEnvironment(contents, expectedRef) {
  const names = new Set(['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_PROJECT_ID']);
  const values = {};
  for (const line of contents.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match || !names.has(match[1])) continue;
    if (Object.hasOwn(values, match[1])) throw new Error(`Duplicate public environment setting ${match[1]}.`);
    let value = match[2].trim();
    if (value.startsWith('"') || value.startsWith("'")) {
      const quote = value[0], end = value.indexOf(quote, 1);
      if (end < 0 || !/^\s*(?:#.*)?$/.test(value.slice(end + 1))) throw new Error(`Invalid quoted public environment setting ${match[1]}.`);
      value = value.slice(1, end);
    } else value = value.replace(/\s+#.*$/, '').trim();
    values[match[1]] = value;
  }
  return publicBackend(values.VITE_SUPABASE_URL, values.VITE_SUPABASE_PUBLISHABLE_KEY, expectedRef, values.VITE_SUPABASE_PROJECT_ID);
}

export function readConfiguration(filename, expectedName) {
  let config;
  try { config = JSON.parse(fs.readFileSync(filename, 'utf8')); }
  catch { throw new Error('Configuration must exist and contain valid JSON. No files were changed.'); }
  if (!config || typeof config !== 'object' || Array.isArray(config) || config.name !== expectedName)
    throw new Error('Configuration name does not match the explicit expected target name.');
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(expectedName)) throw new Error('Expected configuration name is invalid.');
  if (config.vars !== undefined && (!config.vars || typeof config.vars !== 'object' || Array.isArray(config.vars)))
    throw new Error('Configuration vars must be an object.');
  return config;
}

export function freshOutput(filename, inputPaths) {
  const output = path.resolve(filename);
  const inputs = inputPaths.map(input => fs.realpathSync(input));
  if (inputs.some(input => path.resolve(input).toLowerCase() === output.toLowerCase()) || fs.existsSync(output))
    throw new Error('Output must be a new staging file; existing inputs, configs and backups cannot be overwritten.');
  return output;
}

export function writeFreshJson(filename, config) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, JSON.stringify(config, null, 2) + '\n', { flag: 'wx' });
}

// Wrangler resolves these local paths relative to its config file. Moving a
// prepared config must retain the same entrypoint/build directory/schema.
export function relocateConfiguration(config, input, output) {
  const prepared = { ...config };
  for (const field of ['main', 'pages_build_output_dir', '$schema']) {
    const value = config[field];
    if (value === undefined) continue;
    if (typeof value !== 'string' || !value.trim()) throw new Error(`Configuration ${field} must be a nonempty path.`);
    if (/^https?:\/\//.test(value) || path.isAbsolute(value)) continue;
    const absolute = path.resolve(path.dirname(path.resolve(input)), value);
    prepared[field] = path.relative(path.dirname(output), absolute).replaceAll('\\', '/') || '.';
  }
  return prepared;
}

export function configurePublicBindings(argv) {
  const options = argumentsFor(argv, ['--env-file', '--config', '--output', '--expected-project-ref', '--expected-config-name']);
  const output = freshOutput(options['--output'], [options['--env-file'], options['--config']]);
  const config = readConfiguration(options['--config'], options['--expected-config-name']);
  const backend = publicEnvironment(fs.readFileSync(options['--env-file'], 'utf8'), options['--expected-project-ref']);
  const prepared = { ...relocateConfiguration(config, options['--config'], output), vars: { ...config.vars, SUPABASE_URL: backend.url, SUPABASE_PUBLISHABLE_KEY: backend.key } };
  writeFreshJson(output, prepared);
  return { prepared_only: true, output, config_name: config.name, expected_project_ref: backend.ref, public_key_type: backend.keyType, remote_writes: false };
}

const help = 'Prepare a new staging configuration; never overwrite an input or deploy.\nUsage: node scripts/configure-public-bindings.mjs --env-file <target.env> --config <input.jsonc> --output <new-staged.jsonc> --expected-project-ref <20-character-ref> --expected-config-name <name>\nOnly JSON configuration contents are accepted. No key values are logged.\n';
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.slice(2).length === 1 && process.argv[2] === '--help') process.stdout.write(help);
    else process.stdout.write(JSON.stringify(configurePublicBindings(process.argv.slice(2)), null, 2) + '\n');
  } catch (error) {
    process.stderr.write(`Public configuration preparation failed: ${error instanceof Error ? error.message : 'Unknown error'}\n`);
    process.exitCode = 1;
  }
}
