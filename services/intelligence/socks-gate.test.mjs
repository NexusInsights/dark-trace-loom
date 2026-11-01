import assert from 'node:assert/strict';
import { createServer, createConnection } from 'node:net';
import test from 'node:test';
import { startScopedSocksProxy, ScopedSocksError } from './socks-gate.mjs';

const ONION = `${'a'.repeat(56)}.onion`;

async function upstreamFixture({ method = 0, replyStatus = 0 } = {}) {
  const requests = [];
  const sockets = new Set();
  let connections = 0;
  const server = createServer(socket => {
    connections++;
    sockets.add(socket);
    socket.on('error', () => {});
    socket.once('close', () => { sockets.delete(socket); server.emit('fixtureClosed'); });
    let buffered = Buffer.alloc(0);
    let phase = 0;
    socket.on('data', chunk => {
      buffered = Buffer.concat([buffered, chunk]);
      if (phase === 0 && buffered.length >= 3) {
        assert.deepEqual([...buffered.subarray(0, 3)], [5, 1, 0]);
        buffered = buffered.subarray(3);
        socket.write(Buffer.from([5, method]));
        phase = method === 0 ? 1 : 3;
      }
      if (phase === 1 && buffered.length >= 5) {
        const length = buffered[4];
        if (buffered.length < 7 + length) return;
        requests.push({ version: buffered[0], command: buffered[1], addressType: buffered[3],
          hostname: buffered.subarray(5, 5 + length).toString('ascii'), port: buffered.readUInt16BE(5 + length) });
        buffered = buffered.subarray(7 + length);
        socket.write(Buffer.from([5, replyStatus, 0, 1, 0, 0, 0, 0, 0, 0]));
        phase = replyStatus === 0 ? 2 : 3;
      }
      if (phase === 2 && buffered.length) {
        socket.write(Buffer.concat([Buffer.from('echo:'), buffered]));
        buffered = Buffer.alloc(0);
      }
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { server, requests, sockets,
    get connections() { return connections; },
    url: `socks5://127.0.0.1:${server.address().port}`,
    async waitForAllClosed() {
      if (!sockets.size) return;
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { server.off('fixtureClosed', check); reject(new Error('Fixture upstream sockets did not close')); }, 2000);
        const check = () => { if (!sockets.size) { clearTimeout(timeout); server.off('fixtureClosed', check); resolve(); } };
        server.on('fixtureClosed', check);
      });
    },
    async close() { await new Promise(resolve => { server.close(resolve); for (const socket of sockets) socket.destroy(); }); },
  };
}

async function clientFixture(url, { timeout = 3000 } = {}) {
  const parsed = new URL(url);
  const socket = createConnection({ host: parsed.hostname, port: Number(parsed.port) });
  // Register before connection setup so callers can await an actual peer-side
  // close event even when a rejection closes this socket before the assertion.
  const closed = new Promise(resolve => socket.once('close', resolve));
  let buffer = Buffer.alloc(0);
  let pending;
  let failed;
  const settle = () => {
    if (pending && buffer.length >= pending.length) {
      const { length, resolve } = pending; pending = undefined;
      const value = buffer.subarray(0, length); buffer = buffer.subarray(length); resolve(value);
    }
  };
  const fail = error => { failed = error; if (pending) { pending.reject(error); pending = undefined; } };
  socket.on('data', chunk => { buffer = Buffer.concat([buffer, chunk]); settle(); });
  socket.on('error', fail);
  socket.once('end', () => { if (pending) fail(new Error('Fixture connection ended')); });
  socket.setTimeout(timeout, () => socket.destroy(new Error('Fixture client timed out')));
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); });
  return { socket, closed,
    read(length) {
      if (buffer.length >= length) { const value = buffer.subarray(0, length); buffer = buffer.subarray(length); return Promise.resolve(value); }
      if (failed) return Promise.reject(failed);
      return new Promise((resolve, reject) => { pending = { length, resolve, reject }; settle(); });
    },
  };
}

async function greeting(client) {
  client.socket.write(Buffer.from([5, 1, 0]));
  assert.deepEqual([...(await client.read(2))], [5, 0]);
}

function connectPacket(hostname, port = 80) {
  const domain = Buffer.from(hostname, 'ascii');
  const portBytes = Buffer.alloc(2); portBytes.writeUInt16BE(port);
  return Buffer.concat([Buffer.from([5, 1, 0, 3, domain.length]), domain, portBytes]);
}

test('scoped SOCKS gate preserves the approved hostname to upstream and relays real bytes', async t => {
  const upstream = await upstreamFixture();
  const gate = await startScopedSocksProxy(upstream.url, ONION);
  t.after(async () => { await gate.close(); await upstream.close(); });
  const client = await clientFixture(gate.url);
  t.after(() => client.socket.destroy());
  await greeting(client);
  client.socket.write(connectPacket(ONION, 443));
  assert.equal((await client.read(10))[1], 0);
  client.socket.write('controlled-document');
  assert.equal((await client.read(24)).toString(), 'echo:controlled-document');
  assert.deepEqual(upstream.requests, [{ version: 5, command: 1, addressType: 3, hostname: ONION, port: 443 }]);
  assert.equal(upstream.connections, 1);
  await gate.close();
  await upstream.waitForAllClosed();
  assert.equal(upstream.sockets.size, 0);
  await gate.close();
  const address = new URL(gate.url);
  await assert.rejects(new Promise((resolve, reject) => {
    const socket = createConnection({ host: address.hostname, port: Number(address.port) });
    socket.once('connect', () => { socket.destroy(); resolve(); }); socket.once('error', reject);
  }), error => error.code === 'ECONNREFUSED');
});

test('background hosts, alternate onion hosts, IP addresses, and nonweb ports never reach upstream', async t => {
  const upstream = await upstreamFixture();
  const gate = await startScopedSocksProxy(upstream.url, ONION);
  t.after(async () => { await gate.close(); await upstream.close(); });
  const packets = [
    connectPacket('clients2.google.com'), connectPacket('accounts.google.com'),
    connectPacket(`${'b'.repeat(56)}.onion`), connectPacket(ONION, 8080),
    Buffer.from([5, 1, 0, 1, 127, 0, 0, 1, 0, 80]),
    Buffer.from([5, 1, 0, 4, ...new Array(15).fill(0), 1, 1, 187]),
  ];
  for (const packet of packets) {
    const client = await clientFixture(gate.url);
    await greeting(client); client.socket.write(packet);
    assert.notEqual((await client.read(10))[1], 0);
    client.socket.destroy();
  }
  assert.equal(upstream.connections, 0);
  assert.deepEqual(upstream.requests, []);
});

test('fragmented handshakes and uppercase DNS labels are parsed before hostname-form upstream CONNECT', async t => {
  const upstream = await upstreamFixture();
  const gate = await startScopedSocksProxy(upstream.url, ONION.toUpperCase());
  t.after(async () => { await gate.close(); await upstream.close(); });
  const client = await clientFixture(gate.url);
  t.after(() => client.socket.destroy());
  for (const byte of [5, 1, 0]) { client.socket.write(Buffer.from([byte])); await new Promise(resolve => setImmediate(resolve)); }
  assert.deepEqual([...(await client.read(2))], [5, 0]);
  const packet = connectPacket(ONION.toUpperCase(), 80);
  for (let index = 0; index < packet.length; index += 3) { client.socket.write(packet.subarray(index, index + 3)); await new Promise(resolve => setImmediate(resolve)); }
  assert.equal((await client.read(10))[1], 0);
  assert.equal(upstream.requests[0].hostname, ONION);
});

test('malformed, unsupported, and oversized handshakes fail without contacting upstream', async t => {
  const upstream = await upstreamFixture();
  const gate = await startScopedSocksProxy(upstream.url, ONION);
  t.after(async () => { await gate.close(); await upstream.close(); });
  for (const packet of [Buffer.from([4, 1, 0]), Buffer.from([5, 1, 2]), Buffer.alloc(1025, 5)]) {
    const client = await clientFixture(gate.url);
    client.socket.write(packet); assert.deepEqual([...(await client.read(2))], [5, 255]); client.socket.destroy();
  }
  for (const packet of [Buffer.from([5, 2, 0, 3]), Buffer.from([5, 1, 1, 3]), Buffer.from([5, 1, 0, 3, 0])]) {
    const client = await clientFixture(gate.url);
    await greeting(client); client.socket.write(packet); assert.notEqual((await client.read(10))[1], 0); client.socket.destroy();
  }
  assert.equal(upstream.connections, 0);
});

test('upstream authentication and connection failures cannot produce a success reply', async t => {
  for (const options of [{ method: 2 }, { replyStatus: 5 }]) {
    const upstream = await upstreamFixture(options);
    const gate = await startScopedSocksProxy(upstream.url, ONION);
    const client = await clientFixture(gate.url);
    try {
      await greeting(client); client.socket.write(connectPacket(ONION));
      assert.notEqual((await client.read(10))[1], 0);
    } finally { client.socket.destroy(); await gate.close(); await upstream.close(); }
  }
});

test('the seventeenth concurrent client is rejected and close releases pending handshakes', async t => {
  const upstream = await upstreamFixture();
  const gate = await startScopedSocksProxy(upstream.url, ONION);
  const clients = [];
  t.after(async () => { for (const client of clients) client.socket.destroy(); await gate.close(); await upstream.close(); });
  for (let index = 0; index < 16; index++) { const client = await clientFixture(gate.url); clients.push(client); await greeting(client); }
  const rejected = await clientFixture(gate.url); clients.push(rejected);
  assert.deepEqual([...(await rejected.read(2))], [5, 255]);
  assert.equal(upstream.connections, 0);
  await gate.close();
  let peerCloseTimeout;
  try {
    // gate.close() owns the listening/server sockets. The independent remote
    // fixture sockets observe their FIN/close on a later event-loop turn.
    await Promise.race([
      Promise.all(clients.map(client => client.closed)),
      new Promise((_, reject) => {
        peerCloseTimeout = setTimeout(() => reject(new Error('The scoped SOCKS gate did not close every peer connection within 2 seconds.')), 2000);
      }),
    ]);
  } finally { clearTimeout(peerCloseTimeout); }
  for (const client of clients) assert.equal(client.socket.destroyed, true);
});

test('configuration errors are rejected before opening a listening or upstream socket', async () => {
  for (const url of ['http://127.0.0.1:9050', 'socks5://user:pass@127.0.0.1:9050', 'socks5://127.0.0.1', 'socks5://127.0.0.1:9050/path']) {
    await assert.rejects(startScopedSocksProxy(url, ONION), error => error instanceof ScopedSocksError && error.code === 'INVALID_PROXY_CONFIGURATION');
  }
  await assert.rejects(startScopedSocksProxy('socks5://127.0.0.1:9050', 'example.com'), error => error.code === 'INVALID_DESTINATION');
});

test('incomplete SOCKS handshakes expire after the ten-second absolute deadline', { timeout: 13000 }, async t => {
  const upstream = await upstreamFixture();
  const gate = await startScopedSocksProxy(upstream.url, ONION);
  const client = await clientFixture(gate.url, { timeout: 12000 });
  t.after(async () => { client.socket.destroy(); await gate.close(); await upstream.close(); });
  const started = Date.now();
  client.socket.write(Buffer.from([5]));
  await new Promise(resolve => { client.socket.once('close', resolve); });
  assert.ok(Date.now() - started >= 9500, 'The absolute handshake timeout should not close a fresh client early');
  assert.ok(Date.now() - started < 12000, 'Incomplete handshakes must not remain open indefinitely');
  assert.equal(upstream.connections, 0);
});
