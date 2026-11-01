import { readFile, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));

export function prebuiltConfiguration(source, image, root = packageRoot) {
  if (!source || typeof source.account_id !== 'string' || !/^[a-f0-9]{32}$/.test(source.account_id)) throw new Error('The Cloudflare account ID is invalid.');
  const prefix = `registry.cloudflare.com/${source.account_id}/`;
  if (typeof image !== 'string' || !image.startsWith(prefix) || !/^[a-zA-Z0-9/_-]+@sha256:[a-f0-9]{64}$/.test(image.slice(prefix.length))) {
    throw new Error('Use a digest-pinned image from this account\'s Cloudflare registry. Direct GHCR images are not a supported source.');
  }
  const result = structuredClone(source);
  if (result.containers?.length !== 1 || result.containers[0].max_instances !== 1) throw new Error('The prepared deployment must retain its single-instance cap.');
  result.main = resolve(root, source.main);
  result.containers[0].image = image;
  delete result.containers[0].image_build_context;
  delete result.$schema;
  return result;
}

export async function preparePrebuilt(image) {
  const source = JSON.parse(await readFile(resolve(packageRoot, 'wrangler.jsonc'), 'utf8'));
  const result = prebuiltConfiguration(source, image);
  const destination = resolve(packageRoot, '.wrangler/deploy-prebuilt.json');
  await mkdir(dirname(destination), { recursive: true });
  try { await copyFile(destination, `${destination}.backup-${randomUUID()}`, constants.COPYFILE_EXCL); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await writeFile(destination, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  return destination;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  preparePrebuilt(process.argv[2]).then(path => console.log(`Prepared deployment configuration: ${path}`), error => {
    console.error(error.message); process.exitCode = 1;
  });
}
