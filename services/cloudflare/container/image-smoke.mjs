import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdir } from 'node:fs/promises';
import { dispatchAction } from '../../intelligence/service.mjs';
import { probeBrowser, runBoundedCommand } from './browser-readiness.mjs';

const onion = `${'a'.repeat(56)}.onion`;
const sockets = new Set();
const destinations = [];
const fixture = createServer(socket => {
  sockets.add(socket); socket.on('error', () => {}); socket.once('close', () => sockets.delete(socket));
  let buffer = Buffer.alloc(0); let phase = 0;
  socket.on('data', chunk => {
    if (buffer.length + chunk.length > 16384) { socket.destroy(); return; }
    buffer = Buffer.concat([buffer, chunk]);
    if (phase === 0 && buffer.length >= 3) {
      assert.deepEqual([...buffer.subarray(0, 3)], [5, 1, 0]); buffer = buffer.subarray(3); phase = 1; socket.write(Buffer.from([5, 0]));
    }
    if (phase === 1 && buffer.length >= 5) {
      const length = buffer[4]; if (buffer.length < 7 + length) return;
      assert.equal(buffer[3], 3); destinations.push(buffer.subarray(5, 5 + length).toString('ascii'));
      buffer = buffer.subarray(7 + length); phase = 2;
      socket.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
    }
    if (phase === 2 && buffer.includes(Buffer.from('\r\n\r\n'))) {
      const html = '<!doctype html><title>Image fixture</title><p>scoped-image-fixture</p>';
      phase = 3; socket.end(`HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: ${Buffer.byteLength(html)}\r\nConnection: close\r\n\r\n${html}`);
    }
  });
});

try {
  await mkdir('/tmp/intelligence-tor', { recursive: true, mode: 0o700 });
  await runBoundedCommand('/usr/bin/tor', ['--verify-config', '-f', '/app/services/cloudflare/container/torrc']);
  await probeBrowser(process.env);
  await new Promise((resolve, reject) => { fixture.once('error', reject); fixture.listen(0, '127.0.0.1', resolve); });
  const result = await dispatchAction('onion', { url: `http://${onion}/fixture` }, { env: {
    ...process.env, TOR_SOCKS_PROXY: `socks5://127.0.0.1:${fixture.address().port}`,
  } });
  assert.equal(result.title, 'Image fixture'); assert.match(result.text, /scoped-image-fixture/);
  assert.ok(destinations.length > 0); assert.ok(destinations.every(value => value === onion));
  console.log('Image smoke passed: Tor configuration, sandboxed Chromium rendering, and actual Puppeteer + stealth + scoped SOCKS document collection. The SOCKS upstream is synthetic; live Tor bootstrap was not tested.');
} catch (error) {
  console.error(error.message);
  if (error.diagnostic) console.error(error.diagnostic);
  process.exitCode = 1;
} finally {
  for (const socket of sockets) socket.destroy();
  if (fixture.listening) await new Promise(resolve => fixture.close(resolve));
}
