import assert from 'node:assert/strict';
import test from 'node:test';
import { prebuiltConfiguration } from '../scripts/prepare-prebuilt.mjs';

const account = 'da9871f264f6e4268fd904015f5703df';
const source = { account_id: account, main: 'src/index.js', containers: [{ image: './Dockerfile', image_build_context: '../..', max_instances: 1, scheduling_policy: 'default' }] };

test('a prepared managed-registry image retains the account, application and hard instance cap', () => {
  const image = `registry.cloudflare.com/${account}/fixture-worker@sha256:${'a'.repeat(64)}`;
  const result = prebuiltConfiguration(source, image, '/fixture/package');
  assert.equal(result.account_id, account); assert.equal(result.containers[0].image, image);
  assert.equal(result.containers[0].max_instances, 1); assert.equal('image_build_context' in result.containers[0], false);
  assert.notEqual(result.main, source.main); assert.equal(source.containers[0].image, './Dockerfile');
});

test('GHCR, mutable tags, another account and malformed digest sources are rejected', () => {
  for (const image of ['ghcr.io/fixture/worker:latest', `registry.cloudflare.com/${account}/fixture-worker:latest`,
    `registry.cloudflare.com/${'b'.repeat(32)}/fixture-worker@sha256:${'a'.repeat(64)}`,
    `registry.cloudflare.com/${account}/fixture-worker@sha256:bad`]) {
    assert.throws(() => prebuiltConfiguration(source, image), /digest-pinned image/);
  }
});
