import { createServer, createConnection } from 'node:net';

const MAX_HANDSHAKE_BYTES = 1024;
const HANDSHAKE_TIMEOUT_MS = 10000;
const MAX_CONNECTIONS = 16;
const REPLY = status => Buffer.from([5, status, 0, 1, 0, 0, 0, 0, 0, 0]);

export class ScopedSocksError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ScopedSocksError';
    this.code = code;
  }
}

function configuration(upstreamUrl, allowedHostname) {
  let url;
  try { url = new URL(upstreamUrl); }
  catch (cause) { throw new ScopedSocksError('INVALID_PROXY_CONFIGURATION', 'The upstream proxy must be a SOCKS5 URL.', cause); }
  if (url.protocol !== 'socks5:' || !url.hostname || !url.port || url.username || url.password ||
      (url.pathname && url.pathname !== '/') || url.search || url.hash) {
    throw new ScopedSocksError('INVALID_PROXY_CONFIGURATION', 'Use socks5://host:port without credentials or a path.');
  }
  const port = Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ScopedSocksError('INVALID_PROXY_CONFIGURATION', 'The upstream SOCKS port is invalid.');
  if (typeof allowedHostname !== 'string' || !/^[a-z2-7]{56}\.onion$/i.test(allowedHostname)) {
    throw new ScopedSocksError('INVALID_DESTINATION', 'The scoped proxy requires one v3 onion hostname.');
  }
  return { host: url.hostname.replace(/^\[|\]$/g, ''), port, allowed: allowedHostname.toLowerCase() };
}

/** Buffered only during the SOCKS handshake; relay data uses stream backpressure. */
function handshakeReader(socket) {
  let buffer = Buffer.alloc(0);
  let pending;
  let failure;
  function fail(error) {
    if (failure) return;
    failure = error;
    if (pending) { const reject = pending.reject; pending = undefined; reject(error); }
  }
  function pump() {
    if (pending && buffer.length >= pending.length) {
      const { length, resolve } = pending;
      pending = undefined;
      const result = buffer.subarray(0, length);
      buffer = buffer.subarray(length);
      resolve(result);
    }
  }
  const onData = chunk => {
    if (failure) return;
    if (buffer.length + chunk.length > MAX_HANDSHAKE_BYTES) {
      fail(new ScopedSocksError('HANDSHAKE_TOO_LARGE', 'The SOCKS handshake exceeded its buffer limit.'));
      return;
    }
    buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk;
    pump();
  };
  const onError = error => fail(error);
  const onClose = () => fail(new ScopedSocksError('HANDSHAKE_CLOSED', 'The SOCKS connection closed before its handshake completed.'));
  socket.on('data', onData);
  socket.on('error', onError);
  socket.once('end', onClose);
  socket.once('close', onClose);
  return {
    read(length) {
      if (!Number.isInteger(length) || length < 1 || length > MAX_HANDSHAKE_BYTES) return Promise.reject(new ScopedSocksError('INVALID_HANDSHAKE', 'Invalid SOCKS handshake field length.'));
      if (failure) return Promise.reject(failure);
      if (pending) return Promise.reject(new ScopedSocksError('INVALID_HANDSHAKE', 'Concurrent handshake reads are unsupported.'));
      return new Promise((resolve, reject) => { pending = { length, resolve, reject }; pump(); });
    },
    release() {
      socket.pause();
      socket.off('data', onData); socket.off('error', onError);
      socket.off('end', onClose); socket.off('close', onClose);
      if (pending) fail(new ScopedSocksError('HANDSHAKE_CLOSED', 'The handshake reader was closed.'));
      const remaining = buffer;
      buffer = Buffer.alloc(0);
      return remaining;
    },
  };
}

function write(socket, buffer) {
  return new Promise((resolve, reject) => {
    if (socket.destroyed || !socket.writable) { reject(new ScopedSocksError('HANDSHAKE_CLOSED', 'The SOCKS connection is closed.')); return; }
    socket.write(buffer, error => error ? reject(error) : resolve());
  });
}

function deny(socket, response) {
  if (socket.destroyed || !socket.writable) return;
  socket.end(response, () => socket.destroy());
}

/**
 * A local SOCKS5 boundary that permits only one onion hostname on ports 80/443.
 * No upstream connection is opened until the client's requested destination passes.
 */
export async function startScopedSocksProxy(upstreamUrl, allowedHostname) {
  const config = configuration(upstreamUrl, allowedHostname);
  const ownedSockets = new Set();
  const connections = new Set();
  let closing = false;
  let closePromise;
  let runtimeError;

  function track(socket) {
    ownedSockets.add(socket);
    socket.setNoDelay(true);
    // Protocol handlers carry errors to their client. Keep every owned socket's
    // error event observed even while listeners are transferred to relay mode.
    socket.on('error', () => {});
    socket.once('close', () => ownedSockets.delete(socket));
    return socket;
  }

  const server = createServer({ allowHalfOpen: true, highWaterMark: MAX_HANDSHAKE_BYTES }, client => {
    track(client);
    if (closing) { client.destroy(); return; }
    if (connections.size >= MAX_CONNECTIONS) { deny(client, Buffer.from([5, 255])); return; }
    const state = { client, upstream: null, timer: null };
    connections.add(state);
    state.timer = setTimeout(() => {
      client.destroy(new ScopedSocksError('HANDSHAKE_TIMEOUT', 'The SOCKS handshake timed out.'));
      state.upstream?.destroy();
    }, HANDSHAKE_TIMEOUT_MS);
    state.timer.unref?.();
    client.once('close', () => {
      clearTimeout(state.timer);
      connections.delete(state);
      state.upstream?.destroy();
    });
    void handle(state).catch(() => {
      // handle sends a protocol failure before closing; this guards a final
      // socket-write failure without creating an unhandled promise rejection.
      client.destroy(); state.upstream?.destroy();
    });
  });

  server.on('error', error => {
    runtimeError = error;
    for (const socket of ownedSockets) socket.destroy();
  });

  async function handle(state) {
    const { client } = state;
    const clientReader = handshakeReader(client);
    let upstreamReader;
    let greetingAccepted = false;
    let relayStarted = false;
    try {
      const greeting = await clientReader.read(2);
      if (greeting[0] !== 5 || greeting[1] < 1) { deny(client, Buffer.from([5, 255])); return; }
      const methods = await clientReader.read(greeting[1]);
      if (!methods.includes(0)) { deny(client, Buffer.from([5, 255])); return; }
      await write(client, Buffer.from([5, 0]));
      greetingAccepted = true;
      const header = await clientReader.read(4);
      if (header[0] !== 5 || header[2] !== 0) { deny(client, REPLY(1)); return; }
      if (header[1] !== 1) { deny(client, REPLY(7)); return; }
      if (header[3] !== 3) { deny(client, REPLY(8)); return; }
      const hostnameLength = (await clientReader.read(1))[0];
      if (!hostnameLength) { deny(client, REPLY(8)); return; }
      const hostnameBytes = await clientReader.read(hostnameLength);
      const hostname = hostnameBytes.toString('latin1').toLowerCase();
      const portBytes = await clientReader.read(2);
      const port = portBytes.readUInt16BE(0);
      if (hostname !== config.allowed || !/^[a-z2-7]{56}\.onion$/.test(hostname) || ![80, 443].includes(port)) {
        deny(client, REPLY(2)); return;
      }
      if (closing) throw new ScopedSocksError('PROXY_CLOSED', 'The scoped proxy is stopping.');
      const upstream = track(createConnection({ host: config.host, port: config.port, allowHalfOpen: true, highWaterMark: MAX_HANDSHAKE_BYTES }));
      state.upstream = upstream;
      upstreamReader = handshakeReader(upstream);
      upstream.on('error', () => client.destroy());
      await new Promise((resolve, reject) => {
        const connected = () => { cleanup(); resolve(); };
        const failed = error => { cleanup(); reject(error); };
        const ended = () => failed(new ScopedSocksError('UPSTREAM_CLOSED', 'The upstream SOCKS connection closed.'));
        const cleanup = () => { upstream.off('connect', connected); upstream.off('error', failed); upstream.off('close', ended); };
        upstream.once('connect', connected); upstream.once('error', failed); upstream.once('close', ended);
      });
      await write(upstream, Buffer.from([5, 1, 0]));
      const selection = await upstreamReader.read(2);
      if (selection[0] !== 5 || selection[1] !== 0) throw new ScopedSocksError('UPSTREAM_AUTH_UNSUPPORTED', 'The upstream SOCKS server did not accept no-authentication mode.');
      const domain = Buffer.from(config.allowed, 'ascii');
      await write(upstream, Buffer.concat([Buffer.from([5, 1, 0, 3, domain.length]), domain, portBytes]));
      const reply = await upstreamReader.read(4);
      if (reply[0] !== 5 || reply[2] !== 0 || reply[1] !== 0) {
        deny(client, REPLY(reply[0] === 5 && reply[1] >= 1 && reply[1] <= 8 ? reply[1] : 1));
        return;
      }
      if (reply[3] === 1) await upstreamReader.read(4);
      else if (reply[3] === 4) await upstreamReader.read(16);
      else if (reply[3] === 3) {
        const length = (await upstreamReader.read(1))[0];
        if (!length) throw new ScopedSocksError('INVALID_UPSTREAM_REPLY', 'The upstream SOCKS reply has an empty hostname.');
        await upstreamReader.read(length);
      } else throw new ScopedSocksError('INVALID_UPSTREAM_REPLY', 'The upstream SOCKS reply has an unsupported address type.');
      await upstreamReader.read(2);
      await write(client, REPLY(0));
      clearTimeout(state.timer);
      const queuedClient = clientReader.release();
      const queuedUpstream = upstreamReader.release();
      if (queuedClient.length) client.unshift(queuedClient);
      if (queuedUpstream.length) upstream.unshift(queuedUpstream);
      relayStarted = true;
      upstream.once('end', () => { if (!client.destroyed) client.end(() => client.destroy()); });
      upstream.once('close', () => { if (!client.destroyed && !client.writableEnded) client.end(() => client.destroy()); });
      client.on('error', () => upstream.destroy());
      client.pipe(upstream);
      upstream.pipe(client, { end: false });
    } catch {
      deny(client, greetingAccepted ? REPLY(1) : Buffer.from([5, 255]));
    } finally {
      if (!relayStarted) {
        clearTimeout(state.timer);
        clientReader.release(); upstreamReader?.release();
        state.upstream?.destroy();
      }
    }
  }

  try {
    await new Promise((resolve, reject) => {
      const failed = error => { server.off('listening', ready); reject(error); };
      const ready = () => { server.off('error', failed); resolve(); };
      server.once('error', failed); server.once('listening', ready); server.listen(0, '127.0.0.1');
    });
  } catch (cause) {
    closing = true;
    for (const socket of ownedSockets) socket.destroy();
    throw new ScopedSocksError('PROXY_STARTUP_FAILED', 'The scoped SOCKS proxy could not start.', cause);
  }
  const address = server.address();
  return {
    url: `socks5://127.0.0.1:${address.port}`,
    close() {
      if (closePromise) return closePromise;
      closing = true;
      closePromise = (async () => {
        let timeout;
        const stopped = new Promise((resolve, reject) => {
          server.close(error => error && error.code !== 'ERR_SERVER_NOT_RUNNING' ? reject(error) : resolve());
        });
        const closedSockets = Promise.all([...ownedSockets].map(socket => new Promise(resolve => {
          socket.once('close', resolve); socket.destroy();
        })));
        try {
          await Promise.race([
            Promise.all([stopped, closedSockets]),
            new Promise((_, reject) => { timeout = setTimeout(() => reject(new ScopedSocksError('PROXY_SHUTDOWN_FAILED', 'The scoped SOCKS proxy did not release its sockets.')), 3000); }),
          ]);
          if (server.listening || ownedSockets.size) throw new ScopedSocksError('PROXY_SHUTDOWN_FAILED', 'The scoped SOCKS proxy is still active.');
          if (runtimeError) throw new ScopedSocksError('PROXY_RUNTIME_FAILED', 'The scoped SOCKS proxy stopped after a server error.', runtimeError);
        } finally { clearTimeout(timeout); }
      })();
      return closePromise;
    },
  };
}
