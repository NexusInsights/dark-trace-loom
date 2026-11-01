const hasSecret = (value) => typeof value === 'string' && value.trim().length > 0;

function mode(value, fallback, allowed) {
  const selected = value === undefined || value === '' ? fallback : value;
  return typeof selected === 'string' && allowed.includes(selected) ? selected : null;
}

// Configuration metadata only: no environment values, network calls, or claim of
// valid credentials, provider entitlement, available credit, or live connectivity.
export function getProviderReadiness(env = {}) {
  if (!env || typeof env !== 'object' || Array.isArray(env)) throw new TypeError('Pass a provider environment object.');
  const ipinfoMode = mode(env.IPINFO_API_MODE, 'legacy', ['legacy', 'lite', 'lookup']);
  const xMode = mode(env.X_API_MODE, 'browser', ['browser', 'api']);
  return {
    metadataOnly: true,
    liveChecksPerformed: false,
    ipinfo: {
      mode: ipinfoMode, modeValid: ipinfoMode !== null, tokenConfigured: hasSecret(env.IPINFO_TOKEN),
      includedAccessVerified: env.INTELLIGENCE_IPINFO_ALLOWANCE_VERIFIED === 'true',
    },
    hibp: {
      keyConfigured: hasSecret(env.HIBP_API_KEY),
      includedAccessVerified: env.MARKETPLACE_HIBP_FREE_ALLOWANCE_VERIFIED === 'true',
    },
    x: {
      mode: xMode, modeValid: xMode !== null, bearerConfigured: hasSecret(env.X_API_BEARER_TOKEN),
      includedAccessVerified: env.X_INCLUDED_ACCESS_VERIFIED === 'true',
    },
    onion: {
      proxyConfigured: hasSecret(env.TOR_SOCKS_PROXY),
      browserOverrideConfigured: hasSecret(env.PUPPETEER_EXECUTABLE_PATH),
    },
  };
}
