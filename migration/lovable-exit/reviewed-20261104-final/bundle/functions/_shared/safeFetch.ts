// Bound network requests and reject private destinations before every redirect.
// DNS validation does not pin the socket address; fixed provider URLs are preferred.
function ipv4Parts(ip: string): number[] | null {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return null;
  const p = ip.split(".").map(Number);
  return p.every(v => v >= 0 && v <= 255) ? p : null;
}
export function isBlockedAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, "").toLowerCase();
  const v4 = ipv4Parts(ip);
  if (v4) {
    const [a, b] = v4;
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127)
      || (a === 198 && (b === 18 || b === 19));
  }
  if (!ip.includes(":")) return true; // malformed DNS answers fail closed
  const parts = ip.split("::");
  if (parts.length > 2) return true;
  const parse = (s: string) => s ? s.split(":").flatMap(part => {
    const dotted = ipv4Parts(part);
    return dotted ? [(dotted[0] << 8) | dotted[1], (dotted[2] << 8) | dotted[3]] : [parseInt(part, 16)];
  }) : [];
  const left = parse(parts[0]), right = parts.length === 2 ? parse(parts[1]) : [];
  const words = parts.length === 2 ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill(0), ...right] : left;
  if (words.length !== 8 || words.some(v => !Number.isInteger(v) || v < 0 || v > 65535)) return true;
  if (words.slice(0, 5).every(v => v === 0) && (words[5] === 0xffff || words[5] === 0))
    return isBlockedAddress([words[6] >> 8, words[6] & 255, words[7] >> 8, words[7] & 255].join("."));
  return words.every(v => v === 0) || (words.slice(0, 7).every(v => v === 0) && words[7] === 1)
    || (words[0] & 0xfe00) === 0xfc00 || (words[0] & 0xffc0) === 0xfe80
    || (words[0] & 0xff00) === 0xff00;
}
export interface SafeFetchOptions extends RequestInit { allowHttp?: boolean; maxBytes?: number; timeoutMs?: number; maxRedirects?: number; }
const DNS_RESPONSE_MAX_BYTES = 64 * 1024;

// Resolver responses need their own small bound before JSON parsing. Race the
// stream with the same absolute deadline used by the request; a stalled cancel
// callback must not keep the lookup or its caller pending.
async function readDnsAnswers(response: Response, signal: AbortSignal): Promise<string[]> {
  if (Number(response.headers.get("content-length")) > DNS_RESPONSE_MAX_BYTES) {
    void response.body?.cancel().catch(() => undefined);
    throw new Error("DNS resolver response exceeded " + DNS_RESPONSE_MAX_BYTES + " bytes");
  }
  if (!response.body) throw new Error("DNS resolver returned no response body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0, complete = false;
  let rejectAbort: (reason: unknown) => void;
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const onAbort = () => {
    rejectAbort(signal.reason ?? new Error("DNS resolver request aborted"));
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    signal.throwIfAborted();
    for (;;) {
      const next = await Promise.race([reader.read(), aborted]);
      if (next.done) { complete = true; break; }
      total += next.value.byteLength;
      if (total > DNS_RESPONSE_MAX_BYTES) throw new Error("DNS resolver response exceeded " + DNS_RESPONSE_MAX_BYTES + " bytes");
      chunks.push(next.value);
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
    if (!complete) void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new Error("DNS resolver returned invalid JSON"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("DNS resolver returned an invalid response");
  const data = parsed as { Status?: unknown; Answer?: unknown };
  if (data.Status !== undefined && data.Status !== 0) throw new Error("DNS resolver query failed");
  if (data.Answer === undefined) return [];
  if (!Array.isArray(data.Answer) || data.Answer.some(answer => !answer || typeof answer !== "object" || Array.isArray(answer) || typeof answer.type !== "number" || typeof answer.data !== "string")) throw new Error("DNS resolver returned invalid answers");
  return data.Answer.filter(answer => answer.type === 1 || answer.type === 28).map(answer => answer.data);
}
export async function safeFetch(url: string, options: SafeFetchOptions = {}): Promise<Response> {
  const { allowHttp = false, maxBytes = 5 * 1024 * 1024, timeoutMs = 10000, maxRedirects = 3, ...rest } = options;
  const deadline = AbortSignal.timeout(timeoutMs);
  const signal = rest.signal ? AbortSignal.any([deadline, rest.signal]) : deadline;
  const headers = new Headers(rest.headers);
  if (!headers.has("User-Agent")) headers.set("User-Agent", "InsightNexus-OSINT/1.0");
  let current = new URL(url);
  for (let hops = 0; ; hops++) {
    signal.throwIfAborted();
    if (current.username || current.password) throw new Error("URL credentials are not allowed");
    if (current.protocol !== "https:" && !(allowHttp && current.protocol === "http:")) throw new Error("Blocked non-HTTPS URL");
    const host = current.hostname.replace(/^\[|\]$/g, "");
    let addresses = host.includes(":") || ipv4Parts(host) ? [host] : [];
    if (!addresses.length) {
      const answers = await Promise.all(["A", "AAAA"].map(async type => {
        const r = await fetch("https://cloudflare-dns.com/dns-query?name=" + encodeURIComponent(host) + "&type=" + type, { headers: { Accept: "application/dns-json" }, redirect: "error", signal });
        if (!r.ok) throw new Error("DNS resolver HTTP " + r.status);
        return readDnsAnswers(r, signal);
      }));
      addresses = answers.flat();
    }
    if (!addresses.length || addresses.some(isBlockedAddress)) throw new Error("Blocked private or unresolved destination");
    const response = await fetch(current.toString(), { ...rest, headers, redirect: "manual", signal });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location && rest.redirect !== "manual") {
      await response.body?.cancel();
      if (hops >= maxRedirects) throw new Error("Too many redirects");
      const next = new URL(location, current);
      if (next.origin !== current.origin && [...headers.keys()].some(key => /authorization|cookie|api.?key|token/i.test(key)))
        throw new Error("Blocked credential forwarding across origins");
      current = next; continue;
    }
    if (!response.body) return response;
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { await reader.cancel(); throw new Error("Response body exceeded " + maxBytes + " bytes"); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new Response(bytes, { status: response.status, statusText: response.statusText, headers: response.headers });
  }
}
