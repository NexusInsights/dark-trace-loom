import { runOsint as invokeOsint } from "./runOsint";
import { IMAGE_HASH_ALGORITHM, IMAGE_HASH_MAX_BYTES, IMAGE_HASH_MAX_PIXELS, IMAGE_HASH_MAX_SIDE } from "../../../supabase/functions/_shared/imageHash";
import { ToolExecutionError, type ExecutionStatus } from "./executeTool";
import { ToolDefinition } from "./types";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { edgeFunctionError } from "@/lib/edgeFunctionError";
import { normalizePdlResult } from "@/lib/pdlResults";
import {
  Phone, MapPin, Wifi, Shield, Link as LinkIcon, Hash, FileText, Search,
  Server, Lock, Eye, Database, AlertTriangle, Fingerprint, Globe2, Network,
  Binary, KeyRound, Radio, Scan, Code, Camera, Building2, CreditCard,
} from "lucide-react";


async function runOsint<T = Record<string, unknown>>(action: string, params: Record<string, unknown>): Promise<T> { const data = await invokeOsint(action, params); return (action.startsWith("pdl-") ? normalizePdlResult(data) : data) as T; }

// Preserve the paid provider result even when history persistence fails; surface the failure.
async function savePdlLookup(
  lookup_type: "person-enrich" | "person-search" | "company-enrich",
  label: string,
  inputs: Record<string, unknown>,
  result: unknown,
) {
  try {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) throw new Error("No authenticated user to save lookup history");
    const saved = await supabase.from("pdl_lookups").insert([{
      user_id: auth.user.id,
      lookup_type,
      label: label.slice(0, 200),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      inputs: inputs as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      result: result as any,
    }]);
    if (saved.error) throw saved.error;
  } catch (error) {
    toast.warning(`Provider result received, but PDL history could not be saved: ${error instanceof Error ? error.message : "Database write failed"}`);
  }
}

// 1. Phone — country/calling-code resolution (real)
const phoneLookup: ToolDefinition = {
  id: "phone-lookup", name: "Phone Number Intelligence",
  description: "Parse international phone number syntax and numbering-plan region; owner and carrier require provider enrichment",
  icon: Phone, category: "Communications",
  fields: [{ key: "phone", label: "Phone Number", placeholder: "+14155552671", required: true }],
  process: async (inputs) => {
    const phone = inputs.phone.trim();
    const { parsePhoneNumberFromString } = await import("libphonenumber-js/max");
    if (!phone.startsWith("+")) throw new Error("Include the international calling code, beginning with +");
    const parsed = parsePhoneNumberFromString(phone);
    if (!parsed || !parsed.isPossible()) throw new Error("The number is not possible in the current numbering plan");
    return { summary: `${parsed.formatInternational()} — numbering-plan region ${parsed.country || "non-geographic or ambiguous"}; ownership unverified`, details: { input: phone, normalized: parsed.number, country_calling_code: parsed.countryCallingCode, numbering_plan_region: parsed.country || null, valid_pattern: parsed.isValid(), possible: parsed.isPossible(), note: "Local numbering-plan parser. This does not establish the subscriber, carrier, active service, location or registration. Use configured person enrichment for sourced contact records." }, tags: ["phone", "parser"] };
  },
};

// 2. IP Geolocation (real — ip-api.com)
const ipGeo: ToolDefinition = {
  id: "ip-geolocation", name: "IP Geolocation",
  description: "IP geolocation requires an approved HTTPS provider for commercial use",
  icon: MapPin, category: "Reconnaissance",
  fields: [{ key: "ip", label: "IP Address", placeholder: "8.8.8.8", required: true }],
  process: async (inputs) => {
    const ip = inputs.ip.trim();
    const data = await runOsint<{ country?: string; city?: string }>("ip-geo", { ip });
    return { summary: `${ip} → ${data.city || "?"}, ${data.country || "?"}`, details: data, tags: ["ip", "geolocation", "asn"] };
  },
};

// 3. Subdomain Enumeration (real — crt.sh)
const subdomainEnum: ToolDefinition = {
  id: "subdomain-enum", name: "Subdomain Enumeration",
  description: "Discover subdomains via certificate transparency logs (crt.sh)",
  icon: Network, category: "Reconnaissance",
  fields: [{ key: "domain", label: "Root Domain", placeholder: "example.com", required: true }],
  process: async (inputs) => {
    const domain = inputs.domain.trim();
    const data = await runOsint<{ count: number }>("subdomain-enum", { domain });
    return { summary: `Discovered ${data.count} subdomains for ${domain}`, details: data, tags: ["subdomain", "dns", "recon"] };
  },
};

// 4. Port reachability check (real — HEAD probes for HTTP/HTTPS only)
const portScanner: ToolDefinition = {
  id: "port-scanner", name: "HTTP Port Probe",
  description: "Probe HTTP/HTTPS ports (80, 443, 8080, 8443) for reachability",
  icon: Scan, category: "Reconnaissance",
  fields: [{ key: "host", label: "Host or IP", placeholder: "example.com", required: true }],
  process: async (inputs) => {
    const host = inputs.host.trim();
    const probes = [
      { port: 80, url: `http://${host}/` },
      { port: 443, url: `https://${host}/` },
      { port: 8080, url: `http://${host}:8080/` },
      { port: 8443, url: `https://${host}:8443/` },
    ];
    const results = await Promise.all(probes.map(async (p) => {
      try {
        const r = await fetch(p.url, { method: "HEAD", mode: "no-cors", signal: AbortSignal.timeout(5000) });
        return { port: p.port, reachable: r.type === "opaque" || r.status === 0 ? null : true, status: r.status || "opaque", server: r.headers.get("server") };
      } catch { return { port: p.port, reachable: null, status: "unknown" }; }
    }));
    const open = results.filter((r) => r.reachable);
    return {
      status: results.some(r => r.reachable === null) ? "partial" : "success",
      summary: `${open.length}/${probes.length} HTTP(S) responses confirmed on ${host}`,
      details: { host, results, note: "Opaque responses and browser errors cannot prove port reachability. True TCP scanning requires a dedicated scanner." },
      tags: ["port", "scan", "recon"],
    };
  },
};

// 5. Breach Lookup (real — LeakCheck public)
const breachLookup: ToolDefinition = {
  id: "breach-lookup", name: "Breach Lookup",
  description: "Check if an email or username appears in known data breaches (LeakCheck)",
  icon: AlertTriangle, category: "Threat Intel",
  fields: [{ key: "email", label: "Email or Username", placeholder: "user@example.com", required: true }],
  process: async (inputs) => {
    const query = inputs.email.trim();
    const session = await supabase.auth.getSession();
    if (session.error || !session.data.session) throw new Error("Sign in to query the breach provider");
    const response = await fetch("/api/breach-preview", { method:"POST", headers:{"Content-Type":"application/json",Authorization:`Bearer ${session.data.session.access_token}`},body:JSON.stringify({query}),signal:AbortSignal.timeout(25000) });
    const data = await response.json();
    if (!response.ok || data.error) throw new Error(data.error || `Provider request failed (HTTP ${response.status})`);
    return {
      summary: data.found ? `Provider reports ${data.total} exposure records` : "No matches returned in the LeakCheck public preview; broader exposure is unknown",
      details: data, tags: ["breach", "credentials", "threat"],
    };
  },
};

// 6. URL Reputation (real — URLhaus)
const urlReputation: ToolDefinition = {
  id: "url-reputation", name: "URL Reputation Check",
  description: "Check a URL against URLhaus malware/abuse blocklists (abuse.ch)",
  icon: Shield, category: "Threat Intel",
  fields: [{ key: "url", label: "URL", placeholder: "https://suspicious.example.com", required: true }],
  process: async (inputs) => {
    const url = inputs.url.trim();
    const data = await runOsint<{ listed: boolean; threat?: string }>("url-reputation", { url });
    return {
      summary: data.listed ? `LISTED — ${data.threat}` : "Not listed in URLhaus",
      details: data, tags: ["url", "reputation", "phishing"],
    };
  },
};

// 7. Reverse Image Hash — real pHash/dHash via edge function (decodes image bytes)
const reverseImageHash: ToolDefinition = {
  id: "reverse-image-hash", name: "Image Perceptual Hash",
  description: "Compute versioned perceptual hashes from a public HTTPS JPEG or static PNG",
  icon: Camera, category: "Media",
  fields: [{ key: "url", label: "Image URL", placeholder: "https://example.com/img.jpg", required: true }],
  process: async (inputs) => {
    const url = inputs.url.trim();
    const { data, error } = await supabase.functions.invoke("image-hash", { body: { url } });
    let body = data;
    if (error?.context instanceof Response) body = await error.context.clone().json().catch(() => body);
    const status: ExecutionStatus = ["success", "partial", "demo", "not_configured", "error", "unknown_tool"].includes(body?.status) ? body.status : "error";
    if (error || !["success", "partial", "demo"].includes(status)) throw new ToolExecutionError(body?.reason || error?.message || "Image hash returned an invalid outcome", status === "not_configured" || status === "unknown_tool" ? status : "error");
    if (status === "partial" && !body?.result) return { status, summary: body.reason || "Image hash incomplete", details: body, tags: ["image", "partial"] };
    const r = body?.result as { url: string; phash: string; dhash: string; width: number; height: number; format: string; bytes: number; algorithm?: string; sha256?: string; provenance?: { source_url?: string; phash_bits?: number; dhash_bits?: number } };
    if (!r || r.url !== url || typeof r.phash !== "string" || !/^[a-f0-9]{16}$/.test(r.phash)
      || typeof r.dhash !== "string" || !/^[a-f0-9]{16}$/.test(r.dhash) || !Number.isInteger(r.width) || r.width < 1 || r.width > IMAGE_HASH_MAX_SIDE
      || !Number.isInteger(r.height) || r.height < 1 || r.height > IMAGE_HASH_MAX_SIDE || r.width * r.height > IMAGE_HASH_MAX_PIXELS
      || !["png", "jpeg"].includes(r.format) || !Number.isInteger(r.bytes) || r.bytes < 1 || r.bytes > IMAGE_HASH_MAX_BYTES) throw new ToolExecutionError("Image hash returned invalid hash/provenance data");
    const currentContract = r.algorithm === IMAGE_HASH_ALGORITHM && typeof r.sha256 === "string" && /^[a-f0-9]{64}$/.test(r.sha256)
      && r.provenance?.source_url === url && r.provenance?.phash_bits === 63 && r.provenance?.dhash_bits === 64;
    return {
      status: currentContract || status === "demo" ? status : "partial",
      summary: `pHash: ${r.phash} | ${r.width}x${r.height} ${r.format}${currentContract ? "" : " (algorithm/source provenance unverified)"}`,
      details: { url, ...r, ...(!currentContract ? { warnings: ["Legacy or incomplete hash provenance. Do not compare with versioned hashes or treat as accepted case evidence."] } : {}) },
      tags: ["image", "phash", "dhash", ...(status === "demo" ? ["demo"] : [])],
    };
  },
};

// 8. Hash Identifier (real — pure logic)
const hashIdentifier: ToolDefinition = {
  id: "hash-identifier", name: "Hash Identifier",
  description: "Suggest compatible hash formats from length and prefix; the algorithm cannot be proven from format alone",
  icon: Hash, category: "Utility",
  fields: [{ key: "hash", label: "Hash", placeholder: "5d41402abc4b2a76b9719d911017c592", required: true }],
  process: async (inputs) => {
    const h = inputs.hash.trim();
    const len = h.length;
    const guesses: string[] = [];
    if (len === 32 && /^[a-f0-9]+$/i.test(h)) guesses.push("MD5", "NTLM", "MD4");
    if (len === 40 && /^[a-f0-9]+$/i.test(h)) guesses.push("SHA-1", "RIPEMD-160");
    if (len === 56 && /^[a-f0-9]+$/i.test(h)) guesses.push("SHA-224");
    if (len === 64 && /^[a-f0-9]+$/i.test(h)) guesses.push("SHA-256", "SHA3-256", "BLAKE2s");
    if (len === 96 && /^[a-f0-9]+$/i.test(h)) guesses.push("SHA-384");
    if (len === 128 && /^[a-f0-9]+$/i.test(h)) guesses.push("SHA-512", "Whirlpool", "BLAKE2b");
    if (h.startsWith("$2a$") || h.startsWith("$2b$") || h.startsWith("$2y$")) guesses.push("bcrypt");
    if (h.startsWith("$argon2")) guesses.push("Argon2");
    if (h.startsWith("$1$")) guesses.push("MD5 crypt");
    if (h.startsWith("$5$")) guesses.push("SHA-256 crypt");
    if (h.startsWith("$6$")) guesses.push("SHA-512 crypt");
    return {
      summary: guesses.length ? `Likely: ${guesses.join(", ")}` : "Unknown format",
      details: { input: h, length: len, hex: /^[a-f0-9]+$/i.test(h), candidates: guesses },
      tags: ["hash", "crypto", "utility"],
    };
  },
};

// 9. JWT Decoder (real — pure logic)
const jwtDecoder: ToolDefinition = {
  id: "jwt-decoder", name: "JWT Decoder",
  description: "Decode JWT header and payload (no signature verification)",
  icon: KeyRound, category: "Utility",
  fields: [{ key: "token", label: "JWT", type: "textarea", placeholder: "eyJhbGc...", required: true }],
  process: async (inputs) => {
    const t = inputs.token.trim();
    try {
      const [h, p] = t.split(".");
      const dec = (s: string) => JSON.parse(atob(s.replace(/-/g, "+").replace(/_/g, "/")));
      const payload = dec(p);
      const now = Math.floor(Date.now() / 1000);
      return {
        summary: "JWT decoded",
        details: {
          header: dec(h), payload,
          signature_present: t.split(".").length === 3,
          expired: payload.exp ? payload.exp < now : null,
          expires_at: payload.exp ? new Date(payload.exp * 1000).toISOString() : null,
          issued_at: payload.iat ? new Date(payload.iat * 1000).toISOString() : null,
        },
        tags: ["jwt", "auth", "utility"],
      };
    } catch {
      return { summary: "Invalid JWT", details: { input: t, error: "Could not decode" }, tags: ["jwt", "error"] };
    }
  },
};

// 10. Encoder Toolkit (real — pure logic)
const encoderToolkit: ToolDefinition = {
  id: "encoder-toolkit", name: "Encoder Toolkit",
  description: "Encode/decode Base64, URL, and hex strings",
  icon: Binary, category: "Utility",
  fields: [
    { key: "input", label: "Input", type: "textarea", placeholder: "Hello world", required: true },
    {
      key: "operation", label: "Operation", type: "select",
      options: [
        { value: "b64encode", label: "Base64 Encode" }, { value: "b64decode", label: "Base64 Decode" },
        { value: "urlencode", label: "URL Encode" }, { value: "urldecode", label: "URL Decode" },
        { value: "hexencode", label: "Hex Encode" }, { value: "hexdecode", label: "Hex Decode" },
      ],
    },
  ],
  process: async (inputs) => {
    const i = inputs.input; const op = inputs.operation || "b64encode";
    let out = ""; let err: string | undefined;
    try {
      if (op === "b64encode") out = btoa(i);
      else if (op === "b64decode") out = atob(i);
      else if (op === "urlencode") out = encodeURIComponent(i);
      else if (op === "urldecode") out = decodeURIComponent(i);
      else if (op === "hexencode") out = Array.from(i).map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
      else if (op === "hexdecode") out = i.match(/.{1,2}/g)?.map((b) => String.fromCharCode(parseInt(b, 16))).join("") ?? "";
    } catch (e) { err = (e as Error).message; }
    return {
      summary: err ? `Error: ${err}` : `${op} produced ${out.length} chars`,
      details: { operation: op, input: i, output: out, error: err },
      tags: ["encode", "decode", "utility"],
    };
  },
};

// 11. SSL Certificate Inspector (real — SSL Labs)
const sslInspector: ToolDefinition = {
  id: "ssl-inspector", name: "SSL Certificate Inspector",
  description: "Fetch SSL Labs cached TLS analysis (grade, cert, cipher)",
  icon: Lock, category: "Reconnaissance",
  fields: [{ key: "host", label: "Hostname", placeholder: "example.com", required: true }],
  process: async (inputs) => {
    const host = inputs.host.trim();
    const data = await runOsint<{ grade?: string; status?: string }>("ssl-inspect", { host });
    return { status: data.status === "READY" ? "success" : "partial", summary: `${host} → ${data.grade ? `Grade ${data.grade}` : data.status}`, details: data, tags: ["ssl", "tls", "certificate"] };
  },
};

// 12. Dark Web Search (real — Ahmia)
const darkWebSearch: ToolDefinition = {
  id: "dark-web-search", name: "Dark Web Mention Search",
  description: "Search Ahmia's index of Tor hidden services for keyword mentions",
  icon: Eye, category: "Threat Intel",
  fields: [{ key: "keyword", label: "Keyword", placeholder: "company-name or domain", required: true }],
  process: async (inputs) => {
    const keyword = inputs.keyword.trim();
    const data = await runOsint<{ total: number }>("darkweb-search", { keyword });
    return { summary: `${data.total} onion result(s) for "${keyword}"`, details: data, tags: ["darkweb", "threat", "monitor"] };
  },
};

// 13. ASN Lookup (real — bgpview.io)
const asnLookup: ToolDefinition = {
  id: "asn-lookup", name: "ASN Lookup",
  description: "Resolve ASN details and prefix list via BGPView",
  icon: Server, category: "Reconnaissance",
  fields: [{ key: "asn", label: "ASN", placeholder: "AS15169", required: true }],
  process: async (inputs) => {
    const asn = inputs.asn.trim();
    const data = await runOsint<{ name?: string; description?: string }>("asn-lookup", { asn });
    return { summary: `${asn} → ${data.description || data.name}`, details: data, tags: ["asn", "bgp", "network"] };
  },
};

// 14. Crypto Wallet (real — Blockstream for BTC, Ethplorer for ETH)
const walletLookup: ToolDefinition = {
  id: "wallet-lookup", name: "Crypto Wallet Lookup",
  description: "Inspect on-chain balance and transaction history",
  icon: CreditCard, category: "Financial",
  fields: [
    { key: "address", label: "Wallet Address", placeholder: "0x... or bc1...", required: true },
    { key: "chain", label: "Chain", type: "select", options: [
      { value: "btc", label: "Bitcoin" }, { value: "eth", label: "Ethereum" },
    ]},
  ],
  process: async (inputs) => {
    const address = inputs.address.trim();
    const chain = inputs.chain || "eth";
    const action = chain === "btc" ? "btc-wallet" : "eth-wallet";
    const data = await runOsint<{ balance_btc?: string; balance_eth?: string; tx_count?: number }>(action, { address });
    const bal = data.balance_btc ?? data.balance_eth;
    return {
      summary: `${chain.toUpperCase()} wallet — balance ${bal}, ${data.tx_count ?? "?"} txs`,
      details: data, tags: ["crypto", "wallet", "blockchain", chain],
    };
  },
};

// 15. WHOIS / RDAP (real — rdap.org)
const whoisHistory: ToolDefinition = {
  id: "whois-history", name: "Domain WHOIS / RDAP",
  description: "Fetch current WHOIS/RDAP record (registrar, dates, nameservers)",
  icon: FileText, category: "Reconnaissance",
  fields: [{ key: "domain", label: "Domain", placeholder: "example.com", required: true }],
  process: async (inputs) => {
    const domain = inputs.domain.trim();
    const data = await runOsint<{ registrar?: string; registered?: string }>("whois", { domain });
    return {
      summary: `${domain} — ${data.registrar || "unknown registrar"}, registered ${data.registered?.slice(0, 10) || "?"}`,
      details: data, tags: ["whois", "rdap", "domain"],
    };
  },
};

// 16. Social Profile Scrape (retrieved public page + configured independent AI)
const socialScrape: ToolDefinition = {
  id: "social-scrape", name: "Social Profile Scrape",
  description: "Retrieve profile page content and review AI-generated research leads; model interpretations require source verification",
  icon: Globe2, category: "Identity",
  fields: [{ key: "url", label: "Profile URL", placeholder: "https://twitter.com/user", required: true }],
  process: async (inputs) => {
    const u = inputs.url.trim();
    const { data, error } = await supabase.functions.invoke("social-profile-scrape", { body: { url: u } });
    if (error) throw new Error(error.message || "Scrape failed");
    if (data?.error) throw new Error(data.error);
    const host = (() => { try { return new URL(u.startsWith("http") ? u : `https://${u}`).hostname; } catch { return u; } })();
    return {
      summary: `${data.platform} page retrieved (${host}); AI interpretations are unverified research leads`,
      details: {
        platform: data.platform, url: data.url,
        page_title: data.page_title, page_summary: data.page_summary,
        ai_interpretation: data.intel,
        interpretation_warning: "AI output may contain errors. Do not treat inferred aliases, contacts, location, relationships or exposure scores as verified facts. Review the source page.",
        _meta: { scraped_chars: data.scraped_chars, link_count: data.link_count, scraped_via: data.scraped_via },
      },
      tags: ["social", "profile", "osint", String(data.platform || "").toLowerCase()],
    };
  },
};

// 17. Pastebin Search (real — DuckDuckGo site: search)
const pasteSearch: ToolDefinition = {
  id: "paste-search", name: "Pastebin Search",
  description: "Search indexed paste sites (pastebin, rentry, ghostbin) via DuckDuckGo",
  icon: Search, category: "Threat Intel",
  fields: [{ key: "keyword", label: "Keyword", required: true }],
  process: async (inputs) => {
    const keyword = inputs.keyword.trim();
    const data = await runOsint<{ total: number }>("paste-search", { keyword });
    return { summary: `${data.total} paste result(s) for "${keyword}"`, details: data, tags: ["paste", "leak", "monitor"] };
  },
};

// 18. CVE Lookup (real — NIST NVD)
const cveLookup: ToolDefinition = {
  id: "cve-lookup", name: "CVE Lookup",
  description: "Resolve a CVE via NIST NVD: severity, CVSS vector, references, weaknesses",
  icon: AlertTriangle, category: "Threat Intel",
  fields: [{ key: "cve", label: "CVE ID", placeholder: "CVE-2024-12345", required: true }],
  process: async (inputs) => {
    const cve = inputs.cve.trim();
    const data = await runOsint<{ cvss_score?: number; severity?: string }>("cve-lookup", { cve });
    return {
      summary: `${cve}: CVSS ${data.cvss_score ?? "?"} (${data.severity ?? "unknown"})`,
      details: data, tags: ["cve", "vulnerability", "threat"],
    };
  },
};

// 19. DNS Records Query (real — Google DoH)
const dnsQuery: ToolDefinition = {
  id: "dns-query", name: "DNS Records Query",
  description: "Query A, AAAA, MX, TXT, NS, CNAME, SOA via Google DNS-over-HTTPS",
  icon: Database, category: "Reconnaissance",
  fields: [{ key: "domain", label: "Domain", placeholder: "example.com", required: true }],
  process: async (inputs) => {
    const domain = inputs.domain.trim();
    const data = await runOsint<Record<string, string[]>>("dns-query", { domain });
    return { summary: `DNS records resolved for ${domain}`, details: data, tags: ["dns", "records", "recon"] };
  },
};

// 20. Reverse Geocoding (real — Nominatim/OSM)
const geoReverse: ToolDefinition = {
  id: "geo-reverse", name: "Reverse Geocoding",
  description: "Resolve latitude/longitude to address via OpenStreetMap Nominatim",
  icon: MapPin, category: "Geospatial",
  fields: [
    { key: "lat", label: "Latitude", placeholder: "37.7749", required: true },
    { key: "lng", label: "Longitude", placeholder: "-122.4194", required: true },
  ],
  process: async (inputs) => {
    const data = await runOsint<{ display_name?: string }>("reverse-geo", { lat: inputs.lat, lng: inputs.lng });
    return { summary: data.display_name || "Address resolved", details: data, tags: ["geo", "reverse-geocoding"] };
  },
};

// 21. WiFi BSSID — real lookup via WiGLE
const wifiLookup: ToolDefinition = {
  id: "wifi-bssid", name: "WiFi BSSID Lookup",
  description: "Geolocate a WiFi BSSID via WiGLE",
  icon: Wifi, category: "Geospatial",
  fields: [{ key: "bssid", label: "BSSID", placeholder: "AA:BB:CC:DD:EE:FF", required: true }],
  process: async (inputs) => {
    const bssid = inputs.bssid.trim();
    const { data, error } = await supabase.functions.invoke("wigle-lookup", { body: { bssid } });
    if (error) throw new Error(error.message);
    if (data?.status === "not_configured") {
      return {
        summary: data.reason,
        details: { bssid, ...data },
        tags: ["wifi", "bssid", "geo", "not_configured"],
      };
    }
    if (data?.status !== "success") {
      return {
        summary: `WiGLE lookup failed: ${data?.reason ?? "unknown"}`,
        details: { bssid, ...data },
        tags: ["wifi", "bssid", "geo"],
      };
    }
    const r = data.result as { bssid: string; ssid: string | null; city: string | null; country: string | null };
    return {
      summary: `BSSID ${r.bssid} — ${r.ssid ?? "unknown"} (${r.city ?? "?"}, ${r.country ?? "?"})`,
      details: r,
      tags: ["wifi", "bssid", "geo"],
    };
  },
};

// 22. GitHub Recon (real — GitHub public API)
const githubRecon: ToolDefinition = {
  id: "github-recon", name: "GitHub Recon",
  description: "Profile a GitHub user: profile, top repos, languages, commit emails",
  icon: Code, category: "Identity",
  fields: [{ key: "user", label: "GitHub Username", placeholder: "octocat", required: true }],
  process: async (inputs) => {
    const user = inputs.user.trim();
    const data = await runOsint<{ public_repos?: number; followers?: number }>("github-recon", { user });
    return {
      summary: `${user} — ${data.public_repos ?? "?"} repos, ${data.followers ?? "?"} followers`,
      details: data, tags: ["github", "code", "identity"],
    };
  },
};

// 23. Company Lookup — People Data Labs company enrichment
const companyLookup: ToolDefinition = {
  id: "company-lookup", name: "Company Enrichment (PDL)",
  description: "Enrich a company by website, name, LinkedIn URL, or ticker via People Data Labs",
  icon: Building2, category: "Financial",
  fields: [
    { key: "website", label: "Website (preferred)", placeholder: "stripe.com" },
    { key: "name", label: "Company Name", placeholder: "Stripe" },
    { key: "profile", label: "LinkedIn URL", placeholder: "linkedin.com/company/stripe" },
    { key: "ticker", label: "Ticker", placeholder: "AAPL" },
  ],
  process: async (inputs) => {
    const data = await runOsint<Record<string, unknown>>("pdl-company-enrich", inputs);
    const name = (data.display_name || data.name || inputs.website || inputs.name) as string;
    await savePdlLookup("company-enrich", String(name), inputs, data);
    return {
      summary: `${name} — ${data.industry || "?"} • ${data.employee_count || data.size || "?"} employees`,
      details: data,
      tags: ["company", "pdl", "enrichment"],
    };
  },
};

// People Data Labs — Person Enrichment
const pdlPersonEnrich: ToolDefinition = {
  id: "pdl-person-enrich", name: "Person Enrichment (PDL)",
  description: "Enrich a person by email, phone, social profile, or name+company via People Data Labs",
  icon: Fingerprint, category: "Identity",
  fields: [
    { key: "email", label: "Email", placeholder: "jane@example.com" },
    { key: "phone", label: "Phone (E.164)", placeholder: "+14155552671" },
    { key: "profile", label: "Social Profile URL", placeholder: "linkedin.com/in/janedoe" },
    { key: "name", label: "Full Name", placeholder: "Jane Doe" },
    { key: "company", label: "Company (with name)", placeholder: "Acme Inc" },
    { key: "location", label: "Location (optional)", placeholder: "San Francisco, CA" },
  ],
  process: async (inputs) => {
    const data = await runOsint<Record<string, unknown>>("pdl-person-enrich", inputs);
    const name = (data.full_name || inputs.email || inputs.name || "person") as string;
    await savePdlLookup("person-enrich", String(name), inputs, data);
    return {
      summary: `${name} — ${data.job_title || "?"} @ ${data.job_company_name || "?"} (likelihood ${data.likelihood ?? "?"}/10)`,
      details: data,
      tags: ["person", "pdl", "identity", "enrichment"],
    };
  },
};

// People Data Labs — Person Search (form-based)
const pdlPersonSearch: ToolDefinition = {
  id: "pdl-person-search", name: "Person Search (PDL)",
  description: "Find people by name, company, title, location, industry, skill, or school via People Data Labs",
  icon: Search, category: "Identity",
  fields: [
    { key: "name", label: "Full Name", placeholder: "Jane Doe" },
    { key: "company", label: "Company", placeholder: "stripe" },
    { key: "job_title", label: "Job Title", placeholder: "software engineer" },
    { key: "job_role", label: "Job Role", placeholder: "engineering" },
    { key: "location", label: "Location", placeholder: "san francisco, california" },
    { key: "country", label: "Country", placeholder: "united states" },
    { key: "industry", label: "Industry", placeholder: "internet" },
    { key: "skill", label: "Skill", placeholder: "python" },
    { key: "school", label: "School", placeholder: "stanford university" },
    { key: "size", label: "Max Results (1-25)", placeholder: "5" },
    { key: "scroll_token", label: "Continuation Token (optional)", placeholder: "Leave empty for the first batch; use scroll_token from the previous result for the next batch" },
  ],
  process: async (inputs) => {
    const data = await runOsint<{ total: number; returned: number; matches: unknown[]; scroll_token?: string | null }>("pdl-person-search", inputs);
    const label = Object.entries(inputs).filter(([, v]) => v).map(([k, v]) => `${k}:${v}`).join(" ").slice(0, 120) || "search";
    await savePdlLookup("person-search", label, inputs, data);
    return {
      summary: `${data.returned} of ${data.total ?? "?"} matches${data.scroll_token ? " — more results available using the continuation token" : ""}`,
      details: data,
      tags: ["person", "pdl", "search"],
    };
  },
};

// 24. Radio Frequency — pure rule-based real
const radioLookup: ToolDefinition = {
  id: "radio-lookup", name: "Radio Frequency Lookup",
  description: "Identify ITU band and common service for a frequency",
  icon: Radio, category: "Communications",
  fields: [{ key: "freq", label: "Frequency (MHz)", placeholder: "462.5625", required: true }],
  process: async (inputs) => {
    const f = parseFloat(inputs.freq.trim());
    if (!Number.isFinite(f) || f <= 0) throw new Error("Frequency must be a positive number in MHz");
    let band = "Unknown"; let service = "Unknown";
    if (f < 0.003) band = "Below VLF";
    else if (f < 0.03) band = "VLF";
    else if (f < 0.3) band = "LF";
    else if (f < 3) band = "MF";
    else if (f < 30) { band = "HF"; service = "Shortwave / Amateur (HF)"; }
    else if (f < 300) { band = "VHF"; service = f < 88 ? "VHF Low / Marine" : f < 108 ? "FM Broadcast" : f < 137 ? "Aviation" : f < 174 ? "VHF Marine / Amateur" : "VHF Hi"; }
    else if (f < 3000) { band = "UHF"; service = f < 470 ? "UHF Land Mobile / GMRS / Amateur" : f < 698 ? "TV / Public Safety" : f < 960 ? "Cellular" : f < 1700 ? "GPS / DAB" : "UHF Hi"; }
    else if (f < 30000) band = "SHF (microwave)";
    else band = "EHF";
    return {
      summary: `${f} MHz → ${band} (${service})`,
      details: { frequency_mhz: f, band, likely_service: service, wavelength_m: (300 / f).toFixed(4), note: "Allocations vary by ITU region; consult ITU/FCC for authoritative info." },
      tags: ["radio", "spectrum", "comms"],
    };
  },
};

// 25. Browser Fingerprint Analyzer (real — pure parsing)
const fingerprintAnalyzer: ToolDefinition = {
  id: "fingerprint-analyzer", name: "User-Agent Analyzer",
  description: "Parse a User-Agent string into browser, engine, OS, device",
  icon: Fingerprint, category: "Analysis",
  fields: [{ key: "ua", label: "User-Agent", type: "textarea", required: true }],
  process: async (inputs) => {
    const ua = inputs.ua.trim();
    const browser = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Other";
    const engine = /Gecko\//.test(ua) && !/like Gecko/.test(ua) ? "Gecko" : /AppleWebKit/.test(ua) ? "WebKit/Blink" : "Unknown";
    const os = /Windows NT 10/.test(ua) ? "Windows 10/11" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Linux/.test(ua) ? "Linux" : "Unknown";
    const device = /Mobile|Android|iPhone/.test(ua) ? "Mobile" : /iPad|Tablet/.test(ua) ? "Tablet" : "Desktop";
    const versionMatch = ua.match(/(Chrome|Firefox|Safari|Edg|OPR)\/(\d+(\.\d+)*)/);
    return {
      summary: `${browser} on ${os} (${device})`,
      details: { user_agent: ua, browser, browser_version: versionMatch?.[2], engine, os, device, bot: /bot|crawl|spider|headless/i.test(ua) },
      tags: ["fingerprint", "ua", "analysis"],
    };
  },
};

// 26. URL Unshortener (real — server-side redirect chain)
const urlUnshorten: ToolDefinition = {
  id: "url-unshorten", name: "URL Unshortener",
  description: "Follow HTTP redirects to reveal the final destination",
  icon: LinkIcon, category: "Utility",
  fields: [{ key: "url", label: "Short URL", placeholder: "https://bit.ly/abc", required: true }],
  process: async (inputs) => {
    const url = inputs.url.trim();
    const data = await runOsint<{ hops: number; final: string }>("url-unshorten", { url });
    return { summary: `${data.hops} hop(s) → ${data.final}`, details: data, tags: ["url", "redirect", "utility"] };
  },
};

export const extraTools: ToolDefinition[] = [
  phoneLookup, ipGeo, subdomainEnum, portScanner, breachLookup, urlReputation,
  reverseImageHash, hashIdentifier, jwtDecoder, encoderToolkit, sslInspector,
  darkWebSearch, asnLookup, walletLookup, whoisHistory, socialScrape, pasteSearch,
  cveLookup, dnsQuery, geoReverse, wifiLookup, githubRecon, companyLookup,
  radioLookup, fingerprintAnalyzer, urlUnshorten,
  pdlPersonEnrich, pdlPersonSearch,
];
