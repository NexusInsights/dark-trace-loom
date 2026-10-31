/** Browser-only collection. Importing this module never starts collection. */
export class IntelligenceClientError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = "IntelligenceClientError";
    this.code = code;
  }
}

const DEFAULT_NAMESPACE = "intelligence_visitor";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function checkNamespace(namespace) {
  if (typeof namespace !== "string" || !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(namespace)) {
    throw new IntelligenceClientError("invalid_namespace", "The tracking cookie name is invalid.");
  }
  return namespace;
}

/** Dependency injection is used by isolated browser-storage regression tests. */
export function createBrowserClient({
  getWindow = () => typeof window === "undefined" ? null : window,
  getDocument = () => typeof document === "undefined" ? null : document,
  fingerprintLoader = () => import("@fingerprintjs/fingerprintjs"),
  fingerprintTimeoutMs = 20000,
} = {}) {
  if (!Number.isInteger(fingerprintTimeoutMs) || fingerprintTimeoutMs < 1 || fingerprintTimeoutMs > 60000) {
    throw new IntelligenceClientError("invalid_timeout", "The fingerprint timeout must be between 1 and 60000 milliseconds.");
  }
  function environment(required = true) {
    let browserWindow;
    let browserDocument;
    try {
      browserWindow = getWindow();
      browserDocument = getDocument();
    } catch (cause) {
      throw new IntelligenceClientError("browser_unavailable", "Browser access is unavailable.", cause);
    }
    if (!browserWindow || !browserDocument) {
      if (!required) return null;
      throw new IntelligenceClientError("browser_unavailable", "This feature runs in your current browser.");
    }
    return { browserWindow, browserDocument };
  }

  function readCookie(browserDocument, namespace) {
    try {
      const entry = String(browserDocument.cookie || "").split(";").map((value) => value.trim())
        .find((value) => value.startsWith(`${namespace}=`));
      if (!entry) return null;
      const value = decodeURIComponent(entry.slice(namespace.length + 1));
      return UUID_PATTERN.test(value) ? value : null;
    } catch (cause) {
      throw new IntelligenceClientError("tracking_storage_unavailable", "The visitor cookie could not be read.", cause);
    }
  }

  function consentStorage(browserWindow) {
    try {
      const storage = browserWindow.localStorage;
      if (!storage) throw new Error("Local storage is unavailable");
      return storage;
    } catch (cause) {
      throw new IntelligenceClientError("tracking_storage_unavailable", "Browser storage is unavailable; tracking was not enabled.", cause);
    }
  }

  function consentKey(namespace) { return `${namespace}:enabled`; }

  function cookieAttributes(browserWindow, maxAge) {
    return `; Path=/; Max-Age=${maxAge}; SameSite=Lax${browserWindow.location?.protocol === "https:" ? "; Secure" : ""}`;
  }

  function randomVisitorId(browserWindow) {
    try {
      const browserCrypto = browserWindow.crypto;
      if (typeof browserCrypto?.randomUUID === "function") {
        const id = browserCrypto.randomUUID();
        if (!UUID_PATTERN.test(id)) throw new Error("Invalid random UUID");
        return id;
      }
      if (typeof browserCrypto?.getRandomValues !== "function") throw new Error("Secure random generation is unavailable");
      const bytes = browserCrypto.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 15) | 64;
      bytes[8] = (bytes[8] & 63) | 128;
      const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    } catch (cause) {
      throw new IntelligenceClientError("secure_random_unavailable", "A secure visitor identifier could not be generated.", cause);
    }
  }

  function getVisitorTracking(namespace = DEFAULT_NAMESPACE) {
    checkNamespace(namespace);
    const env = environment(false);
    if (!env) return { enabled: false, visitorId: null };
    const { browserWindow, browserDocument } = env;
    try {
      const enabled = consentStorage(browserWindow).getItem(consentKey(namespace)) === "1";
      const visitorId = readCookie(browserDocument, namespace);
      return enabled && visitorId ? { enabled: true, visitorId } : { enabled: false, visitorId: null };
    } catch (cause) {
      if (cause instanceof IntelligenceClientError) throw cause;
      throw new IntelligenceClientError("tracking_storage_unavailable", "The visitor tracking setting could not be read.", cause);
    }
  }

  function enableVisitorTracking(namespace = DEFAULT_NAMESPACE) {
    checkNamespace(namespace);
    const { browserWindow, browserDocument } = environment();
    const current = getVisitorTracking(namespace);
    if (current.enabled) return current;
    const storage = consentStorage(browserWindow);
    let previousConsent;
    let previousCookie;
    try {
      previousConsent = storage.getItem(consentKey(namespace));
      previousCookie = readCookie(browserDocument, namespace);
    } catch (cause) {
      if (cause instanceof IntelligenceClientError) throw cause;
      throw new IntelligenceClientError("tracking_storage_unavailable", "The previous tracking setting could not be read.", cause);
    }
    const visitorId = randomVisitorId(browserWindow);
    try {
      storage.setItem(consentKey(namespace), "1");
      if (storage.getItem(consentKey(namespace)) !== "1") throw new Error("Consent storage did not retain the setting");
      browserDocument.cookie = `${namespace}=${encodeURIComponent(visitorId)}${cookieAttributes(browserWindow, 31536000)}`;
      if (readCookie(browserDocument, namespace) !== visitorId) throw new Error("The browser rejected the visitor cookie");
      return { enabled: true, visitorId };
    } catch (cause) {
      const rollbackFailures = [];
      try {
        if (previousConsent === null) storage.removeItem(consentKey(namespace));
        else storage.setItem(consentKey(namespace), previousConsent);
      } catch (rollbackError) { rollbackFailures.push(rollbackError); }
      try {
        browserDocument.cookie = previousCookie
          ? `${namespace}=${encodeURIComponent(previousCookie)}${cookieAttributes(browserWindow, 31536000)}`
          : `${namespace}=${cookieAttributes(browserWindow, 0)}`;
      } catch (rollbackError) { rollbackFailures.push(rollbackError); }
      throw new IntelligenceClientError(
        "tracking_write_failed",
        rollbackFailures.length ? "Tracking could not be enabled, and browser storage could not be fully restored." : "The browser rejected storage; tracking was not enabled.",
        cause,
      );
    }
  }

  function disableVisitorTracking(namespace = DEFAULT_NAMESPACE) {
    checkNamespace(namespace);
    const { browserWindow, browserDocument } = environment();
    const failures = [];
    try {
      const storage = consentStorage(browserWindow);
      storage.removeItem(consentKey(namespace));
      if (storage.getItem(consentKey(namespace)) !== null) throw new Error("Consent setting was not removed");
    } catch (cause) { failures.push(cause); }
    try {
      browserDocument.cookie = `${namespace}=${cookieAttributes(browserWindow, 0)}`;
      if (readCookie(browserDocument, namespace)) throw new Error("Visitor cookie was not removed");
    } catch (cause) { failures.push(cause); }
    if (failures.length) {
      throw new IntelligenceClientError("tracking_clear_failed", "Browser storage could not be fully cleared. Check your browser's site-data settings.", failures[0]);
    }
    return { enabled: false, visitorId: null };
  }

  async function captureFingerprint() {
    environment();
    let timeout;
    try {
      const result = await Promise.race([
        (async () => {
          const loaded = await fingerprintLoader();
          const fingerprint = loaded.default || loaded;
          if (typeof fingerprint.load !== "function") throw new Error("Fingerprint library is unavailable");
          const agent = await fingerprint.load({ monitoring: false });
          return agent.get();
        })(),
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new IntelligenceClientError("fingerprint_collection_timeout", "Browser fingerprint collection timed out. Try again when the browser is responsive.")), fingerprintTimeoutMs);
        }),
      ]);
      if (typeof result.visitorId !== "string" || !result.visitorId || result.visitorId.length > 256) {
        throw new Error("Fingerprint collection returned an invalid identifier");
      }
      return {
        visitorId: result.visitorId,
        ...(typeof result.confidence?.score === "number" && Number.isFinite(result.confidence.score) && result.confidence.score >= 0 && result.confidence.score <= 1
          ? { confidence: { score: result.confidence.score } } : {}),
        ...(typeof result.version === "string" ? { version: result.version } : {}),
        capturedAt: new Date().toISOString(),
        scope: "current_browser",
      };
    } catch (cause) {
      if (cause instanceof IntelligenceClientError) throw cause;
      throw new IntelligenceClientError("fingerprint_collection_failed", "Browser fingerprint collection failed. Your browser may restrict these attributes.", cause);
    } finally {
      clearTimeout(timeout);
    }
  }

  return { captureFingerprint, getVisitorTracking, enableVisitorTracking, disableVisitorTracking };
}

const browserClient = createBrowserClient();
export const captureFingerprint = browserClient.captureFingerprint;
export const getVisitorTracking = browserClient.getVisitorTracking;
export const enableVisitorTracking = browserClient.enableVisitorTracking;
export const disableVisitorTracking = browserClient.disableVisitorTracking;
