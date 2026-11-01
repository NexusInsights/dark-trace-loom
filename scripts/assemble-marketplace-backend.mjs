import fs from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const dir = path.join(root, 'supabase/functions/osint-tools');
const begin = '// BEGIN GENERATED MARKETPLACE ADAPTERS';
const end = '// END GENERATED MARKETPLACE ADAPTERS';
try {
  let source = await fs.readFile(path.join(dir, 'index.ts'), 'utf8');
  if (source.includes(begin)) {
    const a = source.indexOf(begin), b = source.indexOf(end, a);
    if (b < a) throw new Error('Generated adapter marker is incomplete. Source not modified.');
    source = source.slice(0, a) + source.slice(b + end.length).replace(/^\s*\n/, '');
  }
  const anchor = 'Deno.serve(async (req) => {';
  if (source.split(anchor).length !== 2) throw new Error('Expected one serve entrypoint. Source not modified.');
  const modules = ['../_shared/independentAi.ts', 'marketplacePublic.ts', 'marketplaceOpen.ts', 'marketplaceConnected.ts', 'marketplaceLicensed.ts', 'marketplaceAlternatives.ts', 'marketplaceSocialFull.ts', 'marketplaceAuth.ts', 'marketplaceDispatch.ts'];
  const texts = await Promise.all(modules.map(async file => {
    let contents = await fs.readFile(path.join(dir, file), 'utf8');
    contents = contents.replace(/^import \{ independentAiChat(?:, independentAiConfiguration)? \} from "\.\.\/_shared\/independentAi\.ts";\r?\n/gm, '');
    if (/^import\s/m.test(contents)) throw new Error(`Module ${file} has imports; cannot inline safely.`);
    return `// Source: ${file}\n${contents.replace(/^export /gm, '').replace(/^declare const Deno:.*\n/gm, '')}`;
  }));
  source = source.replace(anchor, `${begin}\n${texts.join('\n\n')}\n${end}\n\n${anchor}`);
  if (!source.includes('case "marketplace-run":')) {
    source = source.replace('    switch (action) {', '    switch (action) {\n      case "marketplace-status": await marketplaceUser(req); return json(marketplaceStatus());\n      case "marketplace-run": return json(await marketplaceRun(req, p));');
  }
  source = source.replace('return json({ error: msg }, 500);', 'return json({ error: msg }, e instanceof MarketplaceHttpError ? e.status : 500);');
  if (!source.includes('case "marketplace-status":') || !source.includes('case "pdl-person-search":')) throw new Error('Required route missing. Source not modified.');
  const backup = path.join(root, 'deployment-evidence/marketplace-build-backup/local-osint-tools.ts');
  try { await fs.access(backup); } catch { await fs.mkdir(path.dirname(backup), { recursive: true }); await fs.copyFile(path.join(dir, 'index.ts'), backup); }
  await fs.writeFile(path.join(dir, 'index.ts'), source);
  await fs.writeFile(path.join(root, 'deployment-evidence/marketplace-build-backup/prepared-osint-tools.ts'), source);
  console.log(JSON.stringify({ assembled_modules: modules.length, bytes: Buffer.byteLength(source), routes: ['marketplace-status', 'marketplace-run'], preserves_pdl: true }));
} catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
