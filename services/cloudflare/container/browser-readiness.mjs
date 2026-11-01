import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

export async function runBoundedCommand(executable, args, { timeoutMs = 15000, signal,
  spawnImpl = spawn, env = { PATH: process.env.PATH, HOME: process.env.HOME } } = {}) {
  return new Promise((resolveResult, reject) => {
    let child;
    let timer;
    let killTimer;
    let finalTimer;
    let stdout = '';
    let stderr = '';
    let failure;
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true; clearTimeout(timer); clearTimeout(killTimer); clearTimeout(finalTimer);
      signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolveResult(result);
    };
    const stop = error => {
      if (failure || settled) return;
      failure = error;
      try { child?.kill('SIGTERM'); } catch { /* The bounded exit postcondition below still applies. */ }
      killTimer = setTimeout(() => {
        try { child?.kill('SIGKILL'); } catch { /* Report a failed exit rather than success. */ }
        finalTimer = setTimeout(() => finish(new Error('The readiness subprocess did not stop after termination.')), 2000);
      }, 2000);
    };
    const abort = () => stop(new Error('The readiness subprocess was cancelled.'));
    if (signal?.aborted) { reject(new Error('The readiness subprocess was cancelled.')); return; }
    try { child = spawnImpl(executable, args, { env, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (error) { reject(error); return; }
    child.once('error', error => { failure = error; });
    child.once('close', code => {
      if (failure) { finish(failure); return; }
      if (code !== 0) {
        const error = new Error('The readiness subprocess failed.');
        error.exitCode = code; error.diagnostic = stderr.slice(0, 8192);
        finish(error); return;
      }
      finish(null, { stdout, stderr, exitCode: code });
    });
    child.stdout?.on('data', chunk => {
      if (Buffer.byteLength(stdout) + chunk.length > 65536) stop(new Error('The readiness subprocess exceeded its output limit.'));
      else stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', chunk => {
      if (Buffer.byteLength(stderr) + chunk.length > 65536) stop(new Error('The readiness subprocess exceeded its output limit.'));
      else stderr += chunk.toString('utf8');
    });
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => stop(new Error('The readiness subprocess timed out.')), timeoutMs);
  });
}

export async function probeBrowser(env = process.env, options = {}) {
  const temporaryRoot = resolve(tmpdir());
  const profile = await mkdtemp(join(temporaryRoot, 'intelligence-readiness-'));
  if (!resolve(profile).startsWith(`${temporaryRoot}${sep}`)) throw new Error('The readiness profile path is invalid.');
  const marker = 'insightnexus-browser-readiness-ok';
  try {
    const result = await runBoundedCommand(env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium', [
      '--headless', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
      '--disable-dev-shm-usage', '--host-resolver-rules=MAP * ~NOTFOUND', `--user-data-dir=${profile}`,
      '--dump-dom', `data:text/html,<title>Intelligence readiness</title><p>${marker}</p>`,
    ], options);
    if (!result.stdout.includes(marker)) throw new Error('Chromium did not render the readiness document.');
    return { verified: true, sandboxDisabled: false };
  } finally { await rm(profile, { recursive: true, force: true }); }
}
