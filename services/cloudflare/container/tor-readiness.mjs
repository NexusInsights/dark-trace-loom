import { createConnection } from 'node:net';
import { readFile } from 'node:fs/promises';

export async function queryTorBootstrap({ host = '127.0.0.1', port = 9051,
  cookiePath = '/tmp/intelligence-tor/control_auth_cookie', timeoutMs = 2000,
  readCookie = path => readFile(path), connect = createConnection } = {}) {
  const cookie = await readCookie(cookiePath);
  if (!Buffer.isBuffer(cookie) || cookie.length !== 32) throw new Error('Tor control authentication is not ready.');
  return new Promise((resolve, reject) => {
    let text = '';
    let settled = false;
    const socket = connect({ host, port });
    const finish = (error, progress) => {
      if (settled) return;
      settled = true; clearTimeout(timeout); socket.destroy();
      if (error) reject(error); else resolve({ progress, ready: progress === 100 });
    };
    const timeout = setTimeout(() => finish(new Error('Tor control readiness timed out.')), timeoutMs);
    socket.once('error', () => finish(new Error('Tor control readiness is unavailable.')));
    socket.once('close', () => { if (!settled) finish(new Error('Tor control readiness closed before replying.')); });
    socket.once('connect', () => {
      socket.write(`AUTHENTICATE ${cookie.toString('hex')}\r\nGETINFO status/bootstrap-phase\r\nQUIT\r\n`);
    });
    socket.on('data', chunk => {
      if (text.length + chunk.length > 8192) { finish(new Error('Tor control readiness response exceeded its limit.')); return; }
      text += chunk.toString('utf8');
      if (/^5\d\d /m.test(text)) { finish(new Error('Tor control readiness rejected authentication or the query.')); return; }
      const phase = text.match(/^250[- ]status\/bootstrap-phase=(?:NOTICE|WARN) BOOTSTRAP .*?PROGRESS=(\d+)(?:\s|\r|$)/m);
      if (phase) {
        const progress = Number(phase[1]);
        if (progress < 0 || progress > 100) finish(new Error('Tor returned invalid bootstrap progress.'));
        else finish(null, progress);
      }
    });
  });
}
