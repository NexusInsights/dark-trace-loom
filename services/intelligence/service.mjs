import { existsSync } from 'node:fs';
import { isIP } from 'node:net';
import { startScopedSocksProxy } from './socks-gate.mjs';
import { getProviderReadiness } from './provider-readiness.mjs';
import { ProviderError, dispatchHTTPProvider, checkHIBPSubscription as checkHTTPSubscription } from './provider-http.mjs';

const ACTIONS = new Set(['ipinfo', 'breach', 'profile', 'onion']);
const MAX_DOCUMENT_BYTES = 512 * 1024;
let activeBrowserOperations = 0;

export class IntelligenceError extends Error {
  constructor(code, message, status = 400, retryAfter, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'IntelligenceError';
    this.code = code;
    this.status = status;
    if (Number.isFinite(retryAfter)) this.retryAfter = retryAfter;
  }
}

export function toErrorResult(error) {
  const known = error instanceof IntelligenceError;
  return { ok: false, error: {
    code: known ? error.code : 'INTERNAL_ERROR',
    message: known ? error.message : 'The intelligence operation could not be completed.',
    ...(known && error.retryAfter !== undefined ? { retryAfter: error.retryAfter } : {}),
  } };
}

function requiredString(value, name, maxLength) {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new IntelligenceError('INVALID_INPUT', `Provide a valid ${name}.`);
  }
  return value.trim();
}

function publicIP(value) {
  const ip = requiredString(value, 'public IP address', 64);
  const version = isIP(ip);
  if (!version) throw new IntelligenceError('INVALID_INPUT', 'Enter an IPv4 or IPv6 address.');
  if (version === 4) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) {
      throw new IntelligenceError('INVALID_INPUT', 'IP geolocation requires a public network address.');
    }
  } else {
    const canonical = new URL(`http://[${ip}]`).hostname.slice(1, -1).toLowerCase();
    if (canonical === '::' || canonical === '::1' || /^(f[cd]|fe[89ab]|ff|::ffff:)/i.test(canonical)) {
      throw new IntelligenceError('INVALID_INPUT', 'IP geolocation requires a public network address.');
    }
  }
  return ip;
}

export function validateAction(action, input = {}) {
  if (!ACTIONS.has(action)) throw new IntelligenceError('INVALID_ACTION', 'Choose a supported intelligence action.');
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new IntelligenceError('INVALID_INPUT', 'Action input must be a JSON object.');
  }
  if (action === 'ipinfo') return { ip: publicIP(input.ip) };
  if (action === 'breach') {
    const email = requiredString(input.email, 'email address', 254);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new IntelligenceError('INVALID_INPUT', 'Enter a valid email address.');
    return { email };
  }
  if (action === 'profile') {
    const username = requiredString(input.username, 'X username', 16).replace(/^@/, '');
    if (!/^[a-z0-9_]{1,15}$/i.test(username)) throw new IntelligenceError('INVALID_INPUT', 'Enter an X username using at most 15 letters, numbers, or underscores.');
    return { username };
  }
  let url;
  try { url = new URL(requiredString(input.url, 'v3 onion URL', 2048)); }
  catch { throw new IntelligenceError('INVALID_INPUT', 'Enter a valid HTTP or HTTPS v3 onion URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || !/^[a-z2-7]{56}\.onion$/i.test(url.hostname) ||
      url.username || url.password || (url.port && !['80', '443'].includes(url.port))) {
    throw new IntelligenceError('INVALID_INPUT', 'Use a v3 onion hostname with HTTP/HTTPS, no credentials, and port 80 or 443.');
  }
  url.hash = '';
  return { url: url.href };
}

function configured(env, name, description) {
  const value = env[name];
  if (typeof value !== 'string' || !value.trim()) throw new IntelligenceError('CONFIGURATION_REQUIRED', `${description} is not configured (${name}).`, 503);
  return value.trim();
}

async function callHTTPProvider(action, input, context) {
  try {
    return await dispatchHTTPProvider(action, input, { getEnv: name => context.env[name], fetchImpl: context.fetchImpl });
  } catch (error) {
    if (error instanceof ProviderError) throw new IntelligenceError(error.code, error.message, error.status, error.retryAfter, error);
    throw error;
  }
}

export async function checkHIBPSubscription(options = {}) {
  try {
    return await checkHTTPSubscription({ getEnv: options.getEnv || (name => (options.env || process.env)[name]), fetchImpl: options.fetchImpl || globalThis.fetch });
  } catch (error) {
    if (error instanceof ProviderError) throw new IntelligenceError(error.code, error.message, error.status, error.retryAfter, error);
    throw error;
  }
}

export function browserExecutable(env = process.env) {
  const configuredPath = env.PUPPETEER_EXECUTABLE_PATH;
  if (configuredPath) {
    if (!existsSync(configuredPath)) throw new IntelligenceError('CONFIGURATION_REQUIRED', 'The configured browser executable is missing.', 503);
    return configuredPath;
  }
  const candidates = process.platform === 'win32' ? [
    `${env.PROGRAMFILES || 'C:\\Program Files'}\\Google\\Chrome\\Application\\chrome.exe`,
    `${env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)'}\\Microsoft\\Edge\\Application\\msedge.exe`,
  ] : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  const found = candidates.find(path => existsSync(path));
  if (!found) throw new IntelligenceError('CONFIGURATION_REQUIRED', 'Set PUPPETEER_EXECUTABLE_PATH to an installed Chromium browser.', 503);
  return found;
}

function torProxy(env) {
  const value = configured(env, 'TOR_SOCKS_PROXY', 'Tor SOCKS5 proxy');
  let url;
  try { url = new URL(value); } catch { throw new IntelligenceError('CONFIGURATION_REQUIRED', 'TOR_SOCKS_PROXY must be a SOCKS5 URL.', 503); }
  if (url.protocol !== 'socks5:' || !url.hostname || !url.port || url.username || url.password || (url.pathname && url.pathname !== '/') || url.search || url.hash) {
    throw new IntelligenceError('CONFIGURATION_REQUIRED', 'TOR_SOCKS_PROXY must be socks5://host:port without credentials or a path.', 503);
  }
  return value;
}

async function closeBrowser(browser) {
  if (!browser) return;
  let timer;
  try {
    await Promise.race([browser.close(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Browser cleanup timed out')), 5000); timer.unref?.(); })]);
  } catch {
    const child = browser.process?.();
    if (!child) throw new IntelligenceError('BROWSER_CLEANUP_FAILED', 'The browser could not be closed cleanly.', 502);
    if (child.exitCode !== null || child.signalCode) return;
    const exited = new Promise((resolve, reject) => {
      let exitTimer;
      const done = () => { clearTimeout(exitTimer); child.off('exit', done); resolve(); };
      child.once('exit', done);
      exitTimer = setTimeout(() => { child.off('exit', done); reject(new IntelligenceError('BROWSER_CLEANUP_FAILED', 'The browser process did not stop after cleanup.', 502)); }, 3000);
      exitTimer.unref?.();
    });
    const killed = child.kill('SIGTERM');
    if (!killed && child.exitCode === null && !child.signalCode) {
      // Wait for the same bounded postcondition; a failed kill must never report success.
    }
    await exited;
  } finally { clearTimeout(timer); }
}

async function withBrowser(context, proxy, operation, allowedHostname) {
  if (activeBrowserOperations >= 2) throw new IntelligenceError('BUSY', 'The browser worker is busy. Retry shortly.', 429, 5);
  activeBrowserOperations++;
  let browser;
  let scopedProxy;
  try {
    if (proxy) scopedProxy = await startScopedSocksProxy(proxy, allowedHostname);
    let launch = context.launchBrowser;
    if (!launch) {
      const puppeteer = (await import('puppeteer-core')).default;
      if (proxy) {
        const extra = await import('puppeteer-extra');
        const addExtra = extra.addExtra || extra.default?.addExtra;
        const stealth = (await import('puppeteer-extra-plugin-stealth')).default;
        const automation = addExtra(puppeteer);
        automation.use(stealth());
        launch = options => automation.launch(options);
      } else launch = options => puppeteer.launch(options);
    }
    const executablePath = context.launchBrowser ? undefined : browserExecutable(context.env);
    const args = ['--disable-background-networking', '--disable-component-update', '--disable-default-apps', '--no-first-run'];
    // Honor the requested HTTP onion port. Chrome's opportunistic HTTPS upgrade
    // can fail at an onion's unopened 443 port without retrying its working 80.
    if (proxy) args.push(`--proxy-server=${scopedProxy.url}`, '--proxy-bypass-list=<-loopback>', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp', '--disable-features=HttpsUpgrades');
    browser = await launch({ executablePath, headless: true, timeout: 15000, protocolTimeout: 20000, args });
    const page = await browser.newPage();
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(proxy ? 30000 : 20000);
    return await operation(page);
  } catch (error) {
    if (error instanceof IntelligenceError) throw error;
    if (error?.code === 'ERR_MODULE_NOT_FOUND') throw new IntelligenceError('CONFIGURATION_REQUIRED', 'Install the application browser-worker dependencies.', 503);
    if (error?.name === 'TimeoutError') throw new IntelligenceError('TIMEOUT', 'The browser operation timed out.', 504);
    throw new IntelligenceError(proxy ? 'TOR_UNAVAILABLE' : 'BROWSER_UNAVAILABLE', proxy ? 'The configured Tor route or onion service could not be reached.' : 'The browser could not load the requested public profile.', 502, undefined, error);
  } finally {
    let cleanupError;
    try { await closeBrowser(browser); } catch (error) { cleanupError = error; }
    try { await scopedProxy?.close(); }
    catch (error) { cleanupError ||= new IntelligenceError('PROXY_CLEANUP_FAILED', 'The scoped Tor proxy could not release its sockets.', 502, undefined, error); }
    activeBrowserOperations--;
    if (cleanupError) throw cleanupError;
  }
}

async function publicProfile(input, context) {
  return withBrowser(context, null, async page => {
    const target = `https://x.com/${input.username}`;
    await page.setRequestInterception(true);
    page.on('request', request => {
      let allowed = false;
      try {
        const url = new URL(request.url());
        allowed = url.protocol === 'https:' && ['x.com', 'twitter.com', 'twimg.com'].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`));
      } catch { /* Block malformed requests. */ }
      const resolution = allowed ? request.continue() : request.abort('blockedbyclient');
      resolution.catch(() => {});
    });
    const response = await page.goto(target, { waitUntil: 'domcontentloaded' });
    if (response && !response.ok()) throw new IntelligenceError('UPSTREAM_BLOCKED', `X returned HTTP ${response.status()}.`, 502);
    try { await page.waitForSelector('[data-testid="UserName"]', { timeout: 12000 }); }
    catch { throw new IntelligenceError('UPSTREAM_BLOCKED', 'X did not expose a public profile. Login, challenge, or account availability may prevent access.', 502); }
    const result = await page.evaluate(() => {
      const text = selector => document.querySelector(selector)?.innerText?.trim() || null;
      const name = text('[data-testid="UserName"]')?.split('\n').map(value => value.trim()).find(Boolean) || null;
      return { name, bio: text('[data-testid="UserDescription"]'), location: text('[data-testid="UserLocation"]') };
    });
    const finalURL = new URL(page.url());
    if (!['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(finalURL.hostname) || /\/i\/flow\/|\/login|\/account\//.test(finalURL.pathname) || !result.name) {
      throw new IntelligenceError('UPSTREAM_BLOCKED', 'The public profile is unavailable without an additional X interaction.', 502);
    }
    return { provider: 'x_public_profile', username: input.username, url: target, ...result, queriedAt: new Date().toISOString() };
  });
}

async function onionDocument(input, context) {
  const proxy = torProxy(context.env);
  const target = new URL(input.url);
  const permittedOrigins = new Set([target.origin]);
  // Chromium may upgrade an HTTP onion navigation to HTTPS. Permit that
  // same-host upgrade while continuing to reject downgrades and other origins.
  if (target.protocol === 'http:' && !target.port) permittedOrigins.add(`https://${target.hostname}`);
  return withBrowser(context, proxy, async page => {
    await page.setJavaScriptEnabled(false);
    const session = await page.createCDPSession();
    let receivedBytes = 0;
    let sizeExceeded = false;
    await session.send('Network.enable');
    session.on('Network.dataReceived', event => {
      receivedBytes += event.dataLength;
      if (receivedBytes > MAX_DOCUMENT_BYTES && !sizeExceeded) {
        sizeExceeded = true;
        page.close().catch(() => {});
      }
    });
    await page.setRequestInterception(true);
    page.on('request', request => {
      let allowed = false;
      try {
        const url = new URL(request.url());
        allowed = permittedOrigins.has(url.origin) && request.resourceType() === 'document';
      } catch { /* Reject malformed and non-HTTP subrequests. */ }
      context.onRequest?.({ url: request.url(), type: request.resourceType(), allowed });
      const resolution = allowed ? request.continue() : request.abort('blockedbyclient');
      resolution.catch(() => {});
    });
    let response;
    try { response = await page.goto(input.url, { waitUntil: 'domcontentloaded', timeout: 30000 }); }
    catch (error) {
      if (sizeExceeded) throw new IntelligenceError('RESPONSE_TOO_LARGE', 'The onion document exceeded the size limit.', 502);
      throw error;
    }
    if (sizeExceeded) throw new IntelligenceError('RESPONSE_TOO_LARGE', 'The onion document exceeded the size limit.', 502);
    if (!response || !response.ok()) throw new IntelligenceError('UPSTREAM_ERROR', `The onion service returned ${response ? `HTTP ${response.status()}` : 'no document'}.`, 502);
    if (!permittedOrigins.has(new URL(page.url()).origin)) throw new IntelligenceError('REDIRECT_BLOCKED', 'The onion service attempted to redirect outside the requested origin.', 502);
    const declared = Number(response.headers()['content-length']);
    if (declared > MAX_DOCUMENT_BYTES) throw new IntelligenceError('RESPONSE_TOO_LARGE', 'The onion document exceeded the size limit.', 502);
    const content = await page.evaluate(limit => ({ title: document.title.slice(0, 500),
      text: (document.body?.innerText || '').slice(0, limit),
      html: document.documentElement.outerHTML.slice(0, limit),
      truncated: document.documentElement.outerHTML.length > limit }), MAX_DOCUMENT_BYTES);
    return { provider: 'tor_browser', url: page.url(), requestedUrl: input.url, ...content, via: 'configured_socks5', queriedAt: new Date().toISOString() };
  }, target.hostname);
}

export async function dispatchAction(action, input, options = {}) {
  const validated = validateAction(action, input);
  const context = { env: options.env || process.env, fetchImpl: options.fetchImpl || globalThis.fetch, launchBrowser: options.launchBrowser, onRequest: options.onRequest };
  if (action === 'ipinfo' || action === 'breach') return callHTTPProvider(action, validated, context);
  if (action === 'profile') {
    const mode = getProviderReadiness(context.env).x.mode;
    if (!mode) throw new IntelligenceError('CONFIGURATION_REQUIRED', 'Set X_API_MODE to browser or api.', 503);
    return mode === 'api' ? callHTTPProvider(action, validated, context) : publicProfile(validated, context);
  }
  return onionDocument(validated, context);
}
