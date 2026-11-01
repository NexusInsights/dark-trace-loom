import { connect } from "cloudflare:sockets";
import { authenticatedUser } from "../_lib/auth.js";

const LIMITS = { max_ports: 10, concurrency: 2, timeout_ms: 1500 };
const COVERAGE = "Actual outbound TCP connection attempts from Cloudflare to an explicitly allowlisted public IPv4 target. No payload, banner, service or operating-system probes. Timeout and connection failure do not prove a closed port. Cloudflare network restrictions apply.";
class RequestError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Vary": "Origin" } });

function publicIPv4(value) {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(value)) return false;
  const [a, b, c, d] = value.split(".").map(Number);
  if ([a, b, c, d].some(n => n > 255) || a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if ((a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)) return false;
  if (a === 192 && ((b === 168) || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) return false;
  if ((a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113)) return false;
  return true;
}

function allowedIPs(env) {
  const raw = typeof env.PORTSCAN_ALLOWED_IPS === "string" ? env.PORTSCAN_ALLOWED_IPS.trim() : "";
  if (!raw) return new Set();
  const targets = raw.split(",").map(s => s.trim());
  if (targets.length > 100 || targets.some(ip => !publicIPv4(ip))) throw new RequestError("PORTSCAN_ALLOWED_IPS must contain at most 100 exact public IPv4 addresses, separated by commas. CIDRs, private addresses, hostnames and wildcard entries are not accepted.", 503);
  return new Set(targets);
}

function portsFrom(value) {
  const supplied = Array.isArray(value) ? value : typeof value === "string" ? value.split(",").map(s => s.trim()) : [];
  if (!supplied.length || supplied.length > LIMITS.max_ports) throw new RequestError("Provide 1–10 explicit TCP ports, as a comma-separated list or integer array.");
  const ports = supplied.map(port => {
    if ((typeof port !== "number" && typeof port !== "string") || !/^\d{1,5}$/.test(String(port))) throw new RequestError("Every port must be an integer from 1 to 65535; ranges are not accepted.");
    const n = Number(port);
    if (!Number.isInteger(n) || n < 1 || n > 65535 || n === 25) throw new RequestError("Every port must be from 1 to 65535, excluding provider-prohibited SMTP port 25.");
    return n;
  });
  return [...new Set(ports)];
}

async function bodyJson(request) {
  if (Number(request.headers.get("content-length") || 0) > 2048) throw new RequestError("Request is too large.", 413);
  if (!request.body) throw new RequestError("Expected a JSON request body.");
  const reader = request.body.getReader(); const decoder = new TextDecoder(); let text = ""; let bytes = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 2048) { await reader.cancel(); throw new RequestError("Request is too large.", 413); }
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
  } finally { reader.releaseLock(); }
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new RequestError("Expected valid JSON."); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new RequestError("Expected a JSON object.");
  return parsed;
}

function sameOrigin(request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw new RequestError("Cross-origin browser access is not permitted for this scan endpoint.", 403);
}

async function verify(request, env) {
  sameOrigin(request);
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) throw new RequestError("Scan authentication is not configured: SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required.", 503);
  const user = await authenticatedUser(request, env);
  if (!user) throw new RequestError("Sign in with a verified session to use this tool.", 401);
  return user;
}

function failureStatus(error) {
  const message = error instanceof Error ? error.message : "";
  if (/proxy request failed|cannot connect to the specified address|TCP Loop detected|prohibited|disallowed|not supported/i.test(message)) return { status: "runtime_blocked", notice: "Cloudflare rejected this connection under its network/runtime restrictions; no remote port state was established." };
  return { status: "unknown", notice: "The connection attempt failed. Refusal, routing, filtering and provider restrictions can be indistinguishable; no closed-port or service claim is made." };
}

async function probe(ip, port) {
  const started = Date.now(); let socket; let timer;
  try {
    socket = connect({ hostname: ip, port }, { secureTransport: "off", allowHalfOpen: false });
    // Both socket promises can reject. Attach handlers before awaiting either one.
    socket.closed.catch(() => undefined);
    const timeout = new Promise(resolve => { timer = setTimeout(() => resolve({ status: "timeout", notice: "No TCP connection was established within 1500 ms; the port may be filtered or unreachable." }), LIMITS.timeout_ms); });
    const opened = socket.opened.then(() => ({ status: "open" }), failureStatus);
    const result = await Promise.race([opened, timeout]);
    return { port, ...result, elapsed_ms: Date.now() - started };
  } catch (error) { return { port, ...failureStatus(error), elapsed_ms: Date.now() - started }; }
  finally {
    clearTimeout(timer);
    if (socket) { try { socket.close().catch(() => undefined); } catch { /* Best-effort cleanup; no false connection-state claim. */ } }
  }
}

export async function onRequestGet({ request, env }) {
  try {
    await verify(request, env); const allowlist = allowedIPs(env);
    return json({ tool: "port-scanner-pro", configured: allowlist.size > 0, missing_config: allowlist.size ? [] : ["PORTSCAN_ALLOWED_IPS"], coverage: COVERAGE, limits: LIMITS });
  } catch (error) { return json({ error: error instanceof RequestError ? error.message : "Scan authentication could not be verified. Check the authentication service and retry." }, error instanceof RequestError ? error.status : 502); }
}

export async function onRequestPost({ request, env }) {
  try {
    await verify(request, env); const allowlist = allowedIPs(env);
    if (!allowlist.size) throw new RequestError("Configure PORTSCAN_ALLOWED_IPS with explicitly authorized public IPv4 targets before scanning. No socket was opened.", 503);
    const body = await bodyJson(request);
    if (body.authorization_confirmed !== true) throw new RequestError("Confirm authorization for this specific target before scanning.", 403);
    if (!publicIPv4(body.ip)) throw new RequestError("ip must be one exact public IPv4 address; private, reserved, CIDR and hostname targets are not accepted.");
    if (!allowlist.has(body.ip)) throw new RequestError("This target is not in PORTSCAN_ALLOWED_IPS. Record target authorization and configure the exact IP before scanning. No socket was opened.", 403);
    const ports = portsFrom(body.ports); const results = new Array(ports.length); let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(LIMITS.concurrency, ports.length) }, async () => {
      for (;;) { const i = cursor++; if (i >= ports.length) return; results[i] = await probe(body.ip, ports[i]); }
    }));
    return json({ source: "Cloudflare TCP sockets", observed_at: new Date().toISOString(), ip: body.ip, ports: results, coverage: COVERAGE });
  } catch (error) { return json({ error: error instanceof RequestError ? error.message : "Scan request failed. No complete scan result was produced." }, error instanceof RequestError ? error.status : 502); }
}

export function onRequestOptions({ request }) {
  try { sameOrigin(request); return new Response(null, { status: 204, headers: { "Allow": "GET, POST, OPTIONS", "Cache-Control": "no-store" } }); }
  catch (error) { return json({ error: error.message }, 403); }
}
