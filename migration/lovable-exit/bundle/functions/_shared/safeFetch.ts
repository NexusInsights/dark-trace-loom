// Hardened fetch helper for OSINT dispatchers.
// - Blocks SSRF to private IP ranges via DNS resolution
// - 10s timeout, 5MB body cap, max 3 redirects
// - HTTPS only by default; opt in via { allowHttp: true } for port probes

const PRIVATE_V4: Array<[number, number, number]> = [
  // [octet0, mask0_value, prefix_octets_to_match]
];

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const v = Number(p);
    if (!Number.isInteger(v) || v < 0 || v > 255) return null;
    n = (n << 8) + v;
  }
  return n >>> 0;
}

function isPrivateV4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return false;
  // 10.0.0.0/8
  if ((n & 0xff000000) === 0x0a000000) return true;
  // 172.16.0.0/12
  if ((n & 0xfff00000) === 0xac100000) return true;
  // 192.168.0.0/16
  if ((n & 0xffff0000) === 0xc0a80000) return true;
  // 127.0.0.0/8
  if ((n & 0xff000000) === 0x7f000000) return true;
  // 169.254.0.0/16
  if ((n & 0xffff0000) === 0xa9fe0000) return true;
  // 0.0.0.0/8
  if ((n & 0xff000000) === 0x00000000) return true;
  return false;
}

function isPrivateV6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fe80:") || lower.startsWith("fe80::")) return true;
  // fc00::/7  -> first byte 0xfc or 0xfd
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true;
  return false;
}

async function resolveHost(hostname: string): Promise<string[]> {
  // If hostname is already an IP literal, return it directly.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return [hostname];
  if (hostname.includes(":")) return [hostname.replace(/^\[|\]$/g, "")];

  const ips: string[] = [];
  for (const type of ["A", "AAAA"]) {
    try {
      const r = await fetch(
        `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=${type}`,
        { headers: { Accept: "application/dns-json" } },
      );
      const j = await r.json();
      for (const a of j.Answer ?? []) {
        if (typeof a.data === "string") ips.push(a.data);
      }
    } catch {
      // ignore; we'll fail closed below if no IPs resolve
    }
  }
  return ips;
}

export interface SafeFetchOptions extends RequestInit {
  allowHttp?: boolean;
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
}

export async function safeFetch(url: string, options: SafeFetchOptions = {}): Promise<Response> {
  const {
    allowHttp = false,
    maxBytes = 5 * 1024 * 1024,
    timeoutMs = 10_000,
    maxRedirects = 3,
    headers,
    ...rest
  } = options;

  let currentUrl = url;
  let hops = 0;

  while (true) {
    const u = new URL(currentUrl);
    if (u.protocol !== "https:" && !(allowHttp && u.protocol === "http:")) {
      throw new Error(`Blocked non-HTTPS URL: ${u.protocol}//${u.hostname}`);
    }

    const ips = await resolveHost(u.hostname);
    if (ips.length === 0) {
      throw new Error(`DNS resolution failed for ${u.hostname}`);
    }
    for (const ip of ips) {
      if (ip.includes(".") ? isPrivateV4(ip) : isPrivateV6(ip)) {
        throw new Error(`Blocked private IP ${ip} for ${u.hostname}`);
      }
    }

    const mergedHeaders = new Headers(headers);
    if (!mergedHeaders.has("User-Agent")) {
      mergedHeaders.set("User-Agent", "InsightNexus-OSINT/1.0");
    }

    const res = await fetch(currentUrl, {
      ...rest,
      headers: mergedHeaders,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      hops++;
      if (hops > maxRedirects) throw new Error(`Exceeded ${maxRedirects} redirects`);
      currentUrl = new URL(res.headers.get("location")!, currentUrl).toString();
      continue;
    }

    // Enforce body size cap by streaming.
    if (res.body) {
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          throw new Error(`Response body exceeded ${maxBytes} bytes`);
        }
        chunks.push(value);
      }
      const merged = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) {
        merged.set(c, offset);
        offset += c.byteLength;
      }
      return new Response(merged, {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
      });
    }
    return res;
  }
}