import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { builderDependencyFindings, verifyBuilderIndependence } from '../../scripts/verify-builder-independence.mjs';

const temporary: string[] = [];
afterEach(() => {
  for (const dir of temporary.splice(0)) {
    const absolute = path.resolve(dir);
    if (path.dirname(absolute) !== path.resolve(tmpdir()) || !path.basename(absolute).startsWith('insight-builder-independence-')) throw new Error('Refusing unexpected temporary cleanup path');
    rmSync(absolute, { recursive: true, force: true });
  }
});
function project() {
  const root = mkdtempSync(path.join(tmpdir(), 'insight-builder-independence-'));
  temporary.push(root);
  for (const name of ['package.json', 'package-lock.json']) writeFileSync(path.join(root, name), '{}');
  writeFileSync(path.join(root, 'vite.config.ts'), 'export default {};');
  writeFileSync(path.join(root, 'index.html'), '<div id="root"></div>');
  mkdirSync(path.join(root, 'src'));
  return root;
}

describe('independent runtime and build guard', () => {
  it.each([
    'fetch("https://ai.gateway.lovable.dev/v1/chat/completions")',
    '<script src="//cdn.lovable.app./runtime.js"></script>',
    'const endpoint="https:\\/\\/project.lovableproject.com/api";',
    'fetch("https://api.%6covable.dev/v1/chat/completions")',
    'fetch("https://user:credential@api.lovable.dev/v1/chat/completions")',
    'window.parent.postMessage({type:"lovable-preview-auth:get"})',
    'const key = env.LOVABLE_API_KEY;',
    'const broker = env.VITE_LOVABLE_OAUTH_BROKER_URL;',
    'import { auth } from "@lovable.dev/cloud-auth-js";',
    '"devDependencies": {"lovable-tagger":"1.0.0"}',
  ])('rejects a concrete builder integration: %s', source => {
    expect(builderDependencyFindings(source, 'source.ts')).not.toHaveLength(0);
  });
  it('permits independent endpoints and domain denial lists without false positives', () => {
    for (const source of ['fetch("https://api.example.test/v1/chat/completions")', 'fetch("https://lovable.dev.example.test/api")', 'const denied = ["lovable.dev", "lovable.app"];'])
      expect(builderDependencyFindings(source, 'source.ts')).toEqual([]);
  });
  it('does not expose source values in diagnostics', () => {
    const result = builderDependencyFindings('const url="https://ai.lovable.dev/?key=private-fixture";', 'worker.ts');
    expect(result).toEqual([{ file: 'worker.ts', line: 1, rule: 'builder-endpoint' }]);
    expect(JSON.stringify(result)).not.toContain('private-fixture');
  });
  it('checks actual runtime inputs while preserving historical evidence and fixture exclusions', () => {
    const root = project();
    mkdirSync(path.join(root, 'docs'));
    writeFileSync(path.join(root, 'docs/history.md'), 'https://lovable.dev/old-release');
    writeFileSync(path.join(root, 'src/fixture.test.ts'), 'fetch("https://lovable.dev/rejected-fixture")');
    expect(verifyBuilderIndependence(root).passed).toBe(true);
    writeFileSync(path.join(root, 'src/active.ts'), 'fetch("https://lovable.dev/active")');
    expect(verifyBuilderIndependence(root)).toMatchObject({ passed: false, findings: [{ file: 'src/active.ts', line: 1, rule: 'builder-endpoint' }] });
  });
  it('checks the compiled artifact as well as source and rejects a missing build', () => {
    const root = project();
    expect(() => verifyBuilderIndependence(root, 'dist')).toThrow('index.html is missing');
    mkdirSync(path.join(root, 'dist/assets'), { recursive: true });
    writeFileSync(path.join(root, 'dist/index.html'), '<div id="root"></div>');
    writeFileSync(path.join(root, 'dist/assets/app.js'), 'fetch("https://oauth.lovable.app/callback")');
    expect(verifyBuilderIndependence(root, 'dist')).toMatchObject({ passed: false, artifactChecked: true });
  });
  it('rejects an artifact path outside the project', () => {
    expect(() => verifyBuilderIndependence(project(), '../outside')).toThrow('inside the project');
  });
});
