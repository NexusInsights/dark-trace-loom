import { getProviderReadiness } from './provider-readiness.mjs';

const MAX_PROVIDER_BYTES = 1024 * 1024;

export class ProviderError extends Error {
  constructor(code, message, status = 400, retryAfter, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ProviderError'; this.code = code; this.status = status;
    if (Number.isFinite(retryAfter)) this.retryAfter = retryAfter;
  }
}

/** @typedef {{getEnv?:(name:string)=>string|undefined,env?:Record<string,string|undefined>,fetchImpl?:typeof fetch}} ProviderOptions */

function contextFor(options) {
  const getEnv = options.getEnv ?? ((name) => options.env?.[name]);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof getEnv !== 'function' || typeof fetchImpl !== 'function') throw new ProviderError('CONFIGURATION_REQUIRED', 'Provider execution dependencies are not configured.', 503);
  return { getEnv, fetchImpl };
}

function configured(context, name, description) {
  const value = context.getEnv(name);
  if (typeof value !== 'string' || !value.trim()) throw new ProviderError('CONFIGURATION_REQUIRED', `${description} is not configured (${name}).`, 503);
  return value.trim();
}

function requiredString(value, description, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new ProviderError('INVALID_INPUT', `Provide a valid ${description}.`);
  return value.trim();
}

function canonicalIP(value) {
  if (/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(value)) {
    const octets = value.split('.').map(Number);
    return octets.every((octet) => octet <= 255) ? octets.join('.') : null;
  }
  if (!value.includes(':') || !/^[a-f0-9:]+$/i.test(value)) return null;
  try {
    const hostname = new URL(`http://[${value}]`).hostname;
    return hostname.startsWith('[') ? hostname.slice(1, -1).toLowerCase() : null;
  } catch { return null; }
}

export function validatePublicIP(value) {
  const text = requiredString(value, 'public IP address', 64);
  const ip = canonicalIP(text);
  if (!ip) throw new ProviderError('INVALID_INPUT', 'Enter an IPv4 or IPv6 address.');
  if (!ip.includes(':')) {
    const [a, b, c] = ip.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) ||
        (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
        (a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 192 && b === 88 && c === 99) ||
        (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113)) {
      throw new ProviderError('INVALID_INPUT', 'IP geolocation requires a public network address.');
    }
  } else if (!/^[23][a-f0-9]{3}:/.test(ip) || ip.startsWith('2001:db8:') || ip.startsWith('2001:2:')) {
    throw new ProviderError('INVALID_INPUT', 'IP geolocation requires a public network address.');
  }
  return text;
}

export function validateHTTPInput(action, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ProviderError('INVALID_INPUT', 'Action input must be a JSON object.');
  if (action === 'ipinfo') return { ip: validatePublicIP(input.ip) };
  if (action === 'breach') {
    const email = requiredString(input.email, 'email address', 254);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ProviderError('INVALID_INPUT', 'Enter a valid email address.');
    return { email };
  }
  if (action === 'profile') {
    const username = requiredString(input.username, 'X username', 16).replace(/^@/, '');
    if (!/^[a-z0-9_]{1,15}$/i.test(username)) throw new ProviderError('INVALID_INPUT', 'Enter an X username using at most 15 letters, numbers, or underscores.');
    return { username };
  }
  throw new ProviderError('INVALID_ACTION', 'Choose a supported HTTP intelligence action.');
}

function retryAfter(response) {
  const value = response.headers.get('retry-after');
  if (!value) return undefined;
  const seconds = /^\d+$/.test(value) ? Number(value) : Math.ceil((Date.parse(value) - Date.now()) / 1000);
  return Number.isFinite(seconds) ? Math.max(1, Math.min(3600, seconds)) : undefined;
}

async function discard(response) {
  // A broken upstream body must not replace a known HTTP status with a generic
  // transport error. The operation still reports that status to its caller.
  await response.body?.cancel().catch(() => {});
}

async function boundedBody(response) {
  if (Number(response.headers.get('content-length')) > MAX_PROVIDER_BYTES) {
    await discard(response);
    throw new ProviderError('RESPONSE_TOO_LARGE', 'The provider response exceeded the size limit.', 502);
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = []; let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_PROVIDER_BYTES) throw new ProviderError('RESPONSE_TOO_LARGE', 'The provider response exceeded the size limit.', 502);
      chunks.push(value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
}

async function providerJSON(url, headers, context, provider, { allowNotFound = false, xStatuses = false } = {}) {
  try {
    const response = await context.fetchImpl(url, { headers, redirect: 'error', signal: AbortSignal.timeout(12000) });
    if (allowNotFound && response.status === 404) { await discard(response); return null; }
    if (response.status === 429) {
      await discard(response);
      throw new ProviderError('RATE_LIMITED', `${provider} rate limit reached. Wait before trying again.`, 429, retryAfter(response));
    }
    if (xStatuses && [401, 402, 403, 404].includes(response.status)) {
      await discard(response);
      const errors = {
        401: ['PROVIDER_AUTHENTICATION_FAILED', 'X API rejected the configured bearer credentials.'],
        402: ['PROVIDER_PAYMENT_REQUIRED', 'X API requires available account credit or entitlement. No purchase or retry was attempted.'],
        403: ['PROVIDER_FORBIDDEN', 'X API denied this app access to the requested profile.'],
        404: ['PROFILE_NOT_FOUND', 'X API did not find that public profile.'],
      };
      throw new ProviderError(errors[response.status][0], errors[response.status][1], response.status);
    }
    if (response.status === 401 || response.status === 403) {
      await discard(response);
      throw new ProviderError('PROVIDER_ACCESS_DENIED', `${provider} rejected the configured credentials or account access.`, 503);
    }
    if (!response.ok) {
      await discard(response);
      throw new ProviderError('UPSTREAM_ERROR', `${provider} returned HTTP ${response.status}.`, 502);
    }
    try { return JSON.parse(await boundedBody(response)); }
    catch (error) {
      if (error instanceof ProviderError || ['AbortError', 'TimeoutError'].includes(error?.name)) throw error;
      throw new ProviderError('INVALID_PROVIDER_RESPONSE', `${provider} returned an invalid JSON response.`, 502);
    }
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (['AbortError', 'TimeoutError'].includes(error?.name)) throw new ProviderError('TIMEOUT', `${provider} did not respond in time.`, 504);
    throw new ProviderError('UPSTREAM_UNAVAILABLE', `${provider} could not be reached.`, 502, undefined, error);
  }
}

function stringField(value, key) {
  const field = value[key];
  if (field === undefined || field === null || field === '') return null;
  if (typeof field !== 'string' || field.length > 4096) throw new ProviderError('INVALID_PROVIDER_RESPONSE', 'The provider returned an invalid field.', 502);
  return field;
}
function objectField(value, key) {
  const field = value[key];
  if (field === undefined || field === null) return {};
  if (typeof field !== 'object' || Array.isArray(field)) throw new ProviderError('INVALID_PROVIDER_RESPONSE', 'The provider returned an invalid field.', 502);
  return field;
}
function coordinateField(value, key, max) {
  const field = value[key];
  if (field === undefined || field === null) return null;
  if (!Number.isFinite(field) || Math.abs(field) > max) throw new ProviderError('INVALID_PROVIDER_RESPONSE', 'The provider returned invalid coordinates.', 502);
  return field;
}

async function lookupIP(input, context) {
  const mode = getProviderReadiness({ IPINFO_API_MODE: context.getEnv('IPINFO_API_MODE') }).ipinfo.mode;
  if (!mode) throw new ProviderError('CONFIGURATION_REQUIRED', 'Set IPINFO_API_MODE to legacy, lite, or lookup.', 503);
  const token = configured(context, 'IPINFO_TOKEN', 'IPinfo access');
  const address = encodeURIComponent(input.ip);
  const url = mode === 'legacy' ? `https://ipinfo.io/${address}/json` : `https://api.ipinfo.io/${mode}/${address}`;
  const data = await providerJSON(url, { Authorization: `Bearer ${token}`, Accept: 'application/json' }, context, 'IPinfo');
  if (!data || Array.isArray(data) || typeof data !== 'object' || typeof data.ip !== 'string' ||
      !canonicalIP(data.ip) || canonicalIP(data.ip) !== canonicalIP(input.ip) || data.error) {
    throw new ProviderError('INVALID_PROVIDER_RESPONSE', 'IPinfo returned an unexpected response.', 502);
  }
  const geo = mode === 'lookup' ? objectField(data, 'geo') : {};
  const as = mode === 'lookup' ? objectField(data, 'as') : {};
  const city = mode === 'lite' ? null : stringField(mode === 'lookup' ? geo : data, 'city');
  const region = mode === 'lite' ? null : stringField(mode === 'lookup' ? geo : data, 'region');
  const countryCode = stringField(mode === 'lookup' ? geo : data, mode === 'legacy' ? 'country' : 'country_code');
  const countryName = mode === 'legacy' ? null : stringField(mode === 'lite' ? data : geo, 'country');
  const continent = mode === 'legacy' ? null : stringField(mode === 'lite' ? data : geo, 'continent');
  const continentCode = mode === 'legacy' ? null : stringField(mode === 'lite' ? data : geo, 'continent_code');
  const asn = mode === 'legacy' ? null : stringField(mode === 'lite' ? data : as, 'asn');
  const asName = mode === 'legacy' ? null : stringField(mode === 'lite' ? data : as, mode === 'lite' ? 'as_name' : 'name');
  const asDomain = mode === 'legacy' ? null : stringField(mode === 'lite' ? data : as, mode === 'lite' ? 'as_domain' : 'domain');
  const legacyLoc = mode === 'legacy' ? stringField(data, 'loc') : null;
  let latitude = mode === 'lookup' ? coordinateField(geo, 'latitude', 90) : null;
  let longitude = mode === 'lookup' ? coordinateField(geo, 'longitude', 180) : null;
  if (legacyLoc !== null) {
    const parts = legacyLoc.split(',');
    if (parts.length !== 2 || parts.some((part) => !part.trim()) ||
        !Number.isFinite(Number(parts[0])) || !Number.isFinite(Number(parts[1])) || Math.abs(Number(parts[0])) > 90 || Math.abs(Number(parts[1])) > 180) {
      throw new ProviderError('INVALID_PROVIDER_RESPONSE', 'IPinfo returned invalid coordinates.', 502);
    }
    latitude = Number(parts[0]); longitude = Number(parts[1]);
  }
  const loc = mode === 'legacy' ? legacyLoc : mode === 'lookup' && latitude !== null && longitude !== null ? `${latitude},${longitude}` : null;
  return {
    provider: 'ipinfo', apiMode: mode, ip: data.ip, hostname: mode === 'lite' ? null : stringField(data, 'hostname'), city, region,
    country: countryCode, countryCode, countryName, continent, continentCode, loc, latitude, longitude,
    asn, asName, asDomain, asType: mode === 'lookup' ? stringField(as, 'type') : null,
    org: mode === 'legacy' ? stringField(data, 'org') : [asn, asName].filter(Boolean).join(' ') || null,
    timezone: mode === 'lite' ? null : stringField(mode === 'lookup' ? geo : data, 'timezone'),
    postal: mode === 'lite' ? null : stringField(mode === 'lookup' ? geo : data, mode === 'lookup' ? 'postal_code' : 'postal'),
    bogon: data.bogon === true,
    coverage: { apiMode: mode, plan: mode === 'lite' ? 'lite' : 'account_dependent',
      geolocation: mode === 'lite' ? 'country_continent' : 'provider_available', cityAvailable: city !== null, coordinatesAvailable: loc !== null },
    scope: 'explicit_ip', queriedAt: new Date().toISOString(),
  };
}

async function lookupBreach(input, context) {
  const key = configured(context, 'HIBP_API_KEY', 'Have I Been Pwned access');
  const data = await providerJSON(`https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(input.email)}?truncateResponse=false`,
    { 'hibp-api-key': key, 'User-Agent': context.getEnv('HIBP_USER_AGENT') || 'TJK-Intelligence-Tools/1.0', Accept: 'application/json' }, context, 'Have I Been Pwned', { allowNotFound: true });
  if (data !== null && (!Array.isArray(data) || data.some((item) => !item || typeof item.Name !== 'string'))) throw new ProviderError('INVALID_PROVIDER_RESPONSE', 'Have I Been Pwned returned an unexpected response.', 502);
  return { provider: 'hibp', email: input.email, matched: Boolean(data?.length),
    breaches: (data || []).map((item) => ({ name: item.Name, domain: item.Domain ?? null, breachDate: item.BreachDate ?? null,
      verified: item.IsVerified ?? null, dataClasses: Array.isArray(item.DataClasses) ? item.DataClasses : [] })),
    coverage: 'public_records', queriedAt: new Date().toISOString() };
}

async function lookupX(input, context) {
  const mode = getProviderReadiness({ X_API_MODE: context.getEnv('X_API_MODE') }).x.mode;
  if (mode !== 'api') throw new ProviderError('CONFIGURATION_REQUIRED', 'Set X_API_MODE to api for the HTTP profile provider.', 503);
  const bearer = configured(context, 'X_API_BEARER_TOKEN', 'X API access');
  if (context.getEnv('X_INCLUDED_ACCESS_VERIFIED') !== 'true') throw new ProviderError('ALLOWANCE_REQUIRED', 'Verify included X API access and set X_INCLUDED_ACCESS_VERIFIED before using this provider. No provider request was made.', 503);
  const url = `https://api.x.com/2/users/by/username/${encodeURIComponent(input.username)}?user.fields=description,location`;
  const body = await providerJSON(url, { Authorization: `Bearer ${bearer}`, Accept: 'application/json' }, context, 'X API', { xStatuses: true });
  const data = body && !Array.isArray(body) && typeof body === 'object' ? body.data : null;
  if (!data || Array.isArray(data) || typeof data !== 'object' || typeof data.id !== 'string' || !/^\d+$/.test(data.id) ||
      typeof data.username !== 'string' || data.username.toLowerCase() !== input.username.toLowerCase() || typeof data.name !== 'string' || !data.name.trim()) {
    throw new ProviderError('INVALID_PROVIDER_RESPONSE', 'X API returned an unexpected profile response.', 502);
  }
  return { provider: 'x_api', username: data.username, url: `https://x.com/${data.username}`, name: stringField(data, 'name'),
    bio: stringField(data, 'description'), location: stringField(data, 'location'), queriedAt: new Date().toISOString() };
}

/** @param {string} action @param {Record<string,unknown>} input @param {ProviderOptions} options */
export async function dispatchHTTPProvider(action, input, options = {}) {
  const validated = validateHTTPInput(action, input);
  const context = contextFor(options);
  if (action === 'ipinfo') return lookupIP(validated, context);
  if (action === 'breach') return lookupBreach(validated, context);
  return lookupX(validated, context);
}

// Explicit account-metadata operation only; never called by a lookup action.
// It neither queries an email nor approves included allowance or billing.
/** @param {ProviderOptions} options */
export async function checkHIBPSubscription(options = {}) {
  const context = contextFor(options);
  const key = configured(context, 'HIBP_API_KEY', 'Have I Been Pwned access');
  const data = await providerJSON('https://haveibeenpwned.com/api/v3/subscription/status',
    { 'hibp-api-key': key, 'User-Agent': context.getEnv('HIBP_USER_AGENT') || 'TJK-Intelligence-Tools/1.0', Accept: 'application/json' }, context, 'Have I Been Pwned');
  if (!data || Array.isArray(data) || typeof data !== 'object' || typeof data.SubscriptionName !== 'string' ||
      !data.SubscriptionName || data.SubscriptionName.length > 128 || typeof data.SubscribedUntil !== 'string' ||
      !Number.isFinite(Date.parse(data.SubscribedUntil)) || !Number.isInteger(data.Rpm) || data.Rpm < 0) {
    throw new ProviderError('INVALID_PROVIDER_RESPONSE', 'Have I Been Pwned returned invalid subscription metadata.', 502);
  }
  return { provider: 'hibp', scope: 'account_metadata', subscriptionName: data.SubscriptionName,
    subscribedUntil: new Date(data.SubscribedUntil).toISOString(), rpm: data.Rpm,
    allowanceVerifiedByCheck: false, checkedAt: new Date().toISOString() };
}
