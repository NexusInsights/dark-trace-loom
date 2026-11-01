import { runOsint } from "./runOsint";
import { extractImageMetadata } from "./imageMetadata";
import { ToolExecutionError, type ExecutionStatus } from "./executeTool";
import { isBlockedAddress } from "../../../supabase/functions/_shared/safeFetch";
import { ToolDefinition, ToolResult } from "./types";
import { localPlateOcr } from './localPlateOcr';
import { geofenceMonitor } from './marketplaceMonitorTools';
import { Globe, User, Mail, Image, Clock } from "lucide-react";
import { extraTools } from "./extraTools";
import { marketplaceLocalTools } from "./marketplaceLocalTools";
import { marketplaceRemoteTools } from "./marketplaceRemoteTools";
import { publicRecordTools } from './publicRecordTools';
import { supabase } from "@/integrations/supabase/client";
import { lookupProfiles } from "@/lib/profileLookup";



// ─── 1. Username Search ───
const usernamePlatforms = [
  "GitHub", "Twitter/X", "Reddit", "Instagram", "LinkedIn",
  "TikTok", "YouTube", "Pinterest", "Telegram", "Discord",
  "Medium", "Dev.to", "Keybase", "HackerOne", "Steam",
];

const usernameSearch: ToolDefinition = {
  id: "username-search",
  name: "Username Search",
  description: "Retrieve exact public account records from GitHub, GitLab, DEV Community, Hacker News and Keybase with source links",
  icon: User,
  category: "Identity",
  fields: [
    { key: "username", label: "Username", placeholder: "e.g. john_doe_42", required: true },
  ],
  process: async (inputs) => {
    const username = inputs.username.trim();
    const data = await lookupProfiles(username.replace(/^@/, ""));
    if (data.checks.every(c => c.status === "unavailable")) throw new Error("All profile providers are unavailable; no account existence was established");
    return {
      summary: `${data.profiles.length} public account records for "${username}"; ${data.checks.filter(c => c.status === "unavailable").length} unavailable providers. Shared handles do not prove shared ownership.`,
      details: { ...data }, tags: ["identity", "username", "public-api"],
    };
  },
};

// ─── 2. Domain Intelligence ───
const domainIntel: ToolDefinition = {
  id: "domain-intel",
  name: "Domain Intelligence",
  description: "Combined WHOIS/RDAP + DNS with optional configured IP geolocation",
  icon: Globe,
  category: "Reconnaissance",
  fields: [
    { key: "domain", label: "Domain", placeholder: "e.g. example.com", required: true },
  ],
  process: async (inputs) => {
    let domain: string;
    try {
      const input = inputs.domain.trim();
      const url = new URL(input.includes("://") ? input : "https://" + input);
      domain = url.hostname.toLowerCase().replace(/\.$/, "");
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || !domain.includes(".") || /^\d+(?:\.\d+){3}$/.test(domain)
        || domain.length > 253 || domain.split(".").some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) throw new Error();
    } catch { throw new ToolExecutionError("Enter a DNS domain or an HTTP(S) URL without credentials"); }
    type Source = { status: ExecutionStatus; data?: Record<string, unknown>; reason?: string };
    const capture = async (action: string, params: Record<string, unknown>, validate: (data: Record<string, unknown>) => boolean): Promise<Source> => {
      try {
        const data = await runOsint<Record<string, unknown>>(action, params);
        if (Array.isArray(data) || !validate(data)) throw new ToolExecutionError("Provider returned invalid " + action + " data");
        return { data, status: data.status === "partial" ? "partial" : data.status === "demo" ? "demo" : "success" };
      } catch (error) {
        return { status: error instanceof ToolExecutionError ? error.status : "error", reason: error instanceof Error ? error.message : "Source unavailable" };
      }
    };
    const dnsKeys = ["a", "aaaa", "mx", "txt", "ns", "cname", "soa"];
    const [whois, dns] = await Promise.all([
      capture("whois", { domain }, data => typeof data.domain === "string" && data.domain.toLowerCase() === domain
        && [data.handle, data.registrar, data.registered, ...(Array.isArray(data.nameservers) ? data.nameservers : [])].some(value => typeof value === "string" && value.length > 0)),
      capture("dns-query", { domain }, data => data.domain === domain && dnsKeys.every(key => Array.isArray(data[key]) && (data[key] as unknown[]).every(value => typeof value === "string"))),
    ]);
    let hosting: Source | { status: "skipped"; reason: string } = { status: "skipped", reason: dns.data ? "DNS returned no public A address" : "DNS unavailable" };
    const addresses = Array.isArray(dns.data?.a) ? dns.data.a as string[] : [];
    if (addresses.length) {
      const ip = addresses.find(address => /^\d{1,3}(?:\.\d{1,3}){3}$/.test(address) && !isBlockedAddress(address));
      hosting = ip ? await capture("ip-geo", { ip }, data => data.ip === ip && [data.country, data.isp, data.org, data.asn].some(value => typeof value === "string" && value.length > 0))
        : { status: "error", reason: "DNS returned only non-public or invalid A addresses; hosting lookup was not sent" };
    }
    const statuses = [whois.status, dns.status, ...(hosting.status === "skipped" ? [] : [hosting.status])];
    const status: ExecutionStatus = statuses.includes("demo") ? "demo"
      : statuses.every(value => value === "success") ? "success"
      : statuses.some(value => value === "success" || value === "partial") ? "partial"
      : statuses.every(value => value === "not_configured") ? "not_configured"
      : statuses.every(value => value === "unknown_tool") ? "unknown_tool" : "error";
    const value = (source: Source) => source.data ?? { status: source.status, error: source.reason };
    return {
      status,
      summary: `Domain lookup ${status} for ${domain}`,
      details: { domain, whois: value(whois), dns: value(dns), hosting: hosting.status === "skipped" ? null : value(hosting),
        source_statuses: { whois: { status: whois.status, reason: whois.reason }, dns: { status: dns.status, reason: dns.reason }, hosting: { status: hosting.status, reason: hosting.reason } },
        ...(status === "demo" ? { demo: true } : {}) },
      tags: ["domain", "dns", "whois", ...(status === "demo" ? ["demo"] : [])],
    };
  },
};

// ─── 3. Email Header Analysis ───
const emailHeaderAnalysis: ToolDefinition = {
  id: "email-header-analysis",
  name: "Email Header Analysis",
  description: "Parse email headers to trace origin, relay path, and authentication",
  icon: Mail,
  category: "Analysis",
  fields: [
    { key: "headers", label: "Email Headers", type: "textarea", placeholder: "Paste full email headers here...", required: true },
  ],
  process: async (inputs) => {
    const raw = inputs.headers.trim();

    const lines = raw.split("\n");
    const fromMatch = raw.match(/From:\s*(.+)/i);
    const toMatch = raw.match(/To:\s*(.+)/i);
    const subjectMatch = raw.match(/Subject:\s*(.+)/i);
    const receivedCount = lines.filter((l) => l.trim().toLowerCase().startsWith("received:")).length;

    const spfPass = raw.toLowerCase().includes("spf=pass");
    const dkimPass = raw.toLowerCase().includes("dkim=pass");
    const dmarcPass = raw.toLowerCase().includes("dmarc=pass");

    return {
      summary: `Analyzed ${lines.length} header lines, ${receivedCount} relay hops detected`,
      details: {
        from: fromMatch?.[1]?.trim() ?? "Unknown",
        to: toMatch?.[1]?.trim() ?? "Unknown",
        subject: subjectMatch?.[1]?.trim() ?? "Unknown",
        relay_hops: receivedCount,
        total_lines: lines.length,
        authentication: {
          spf: raw.match(/spf=(pass|fail|softfail|neutral|none|temperror|permerror)/i)?.[1] || "not reported",
          dkim: raw.match(/dkim=(pass|fail|neutral|none|temperror|permerror)/i)?.[1] || "not reported",
          dmarc: raw.match(/dmarc=(pass|fail|bestguesspass|none|temperror|permerror)/i)?.[1] || "not reported",
        },
        note: "Reports authentication claims contained in the supplied headers. This parser does not independently verify SPF, DKIM signatures, sender ownership or DMARC.",
        risk_indicators: [
          ...(/spf=fail/i.test(raw) ? ["The supplied header reports SPF failure"] : []),
          ...(/dkim=fail/i.test(raw) ? ["The supplied header reports DKIM failure"] : []),
          ...(receivedCount > 5 ? ["Unusually high relay count"] : []),
        ],
      },
      tags: ["email", "headers", "authentication"],
    };
  },
};

// ─── 4. Image Metadata Extraction ───
const imageMetadata: ToolDefinition = {
  id: "image-metadata",
  name: "Image Metadata Extraction",
  description: "Fetch a public HTTPS JPEG or PNG and read embedded metadata (camera, GPS, dates)",
  icon: Image,
  category: "Media",
  fields: [
    { key: "image_url", label: "Image URL", placeholder: "https://example.com/photo.jpg", required: true },
    { key: "notes", label: "Notes", type: "textarea", placeholder: "Additional context..." },
  ],
  process: async (inputs) => {
    return extractImageMetadata(inputs);
  },
};

// ─── 5. Timestamp Decoder ───
const timestampDecoder: ToolDefinition = {
  id: "timestamp-decoder",
  name: "Timestamp Decoder",
  description: "Convert between Unix, ISO 8601, and human-readable timestamps",
  icon: Clock,
  category: "Utility",
  fields: [
    { key: "timestamp", label: "Timestamp", placeholder: "e.g. 1700000000 or 2024-01-15T10:30:00Z", required: true },
    {
      key: "format", label: "Input Format", type: "select",
      options: [
        { value: "auto", label: "Auto-detect" },
        { value: "unix", label: "Unix (seconds)" },
        { value: "unix_ms", label: "Unix (milliseconds)" },
        { value: "iso", label: "ISO 8601" },
      ],
    },
  ],
  process: async (inputs) => {
    const raw = inputs.timestamp.trim();

    let date: Date;
    let detectedFormat = inputs.format || "auto";

    if (detectedFormat === "auto") {
      if (/^\d{10}$/.test(raw)) detectedFormat = "unix";
      else if (/^\d{13}$/.test(raw)) detectedFormat = "unix_ms";
      else detectedFormat = "iso";
    }

    switch (detectedFormat) {
      case "unix": date = new Date(parseInt(raw) * 1000); break;
      case "unix_ms": date = new Date(parseInt(raw)); break;
      default: date = new Date(raw);
    }

    const valid = !isNaN(date.getTime());

    return {
      summary: valid
        ? `Decoded to ${date.toISOString()}`
        : `Invalid timestamp: "${raw}"`,
      details: valid ? {
        input: raw,
        detected_format: detectedFormat,
        conversions: {
          iso_8601: date.toISOString(),
          unix_seconds: Math.floor(date.getTime() / 1000),
          unix_milliseconds: date.getTime(),
          utc: date.toUTCString(),
          local: date.toLocaleString(),
          relative: getRelativeTime(date),
        },
        breakdown: {
          year: date.getUTCFullYear(),
          month: date.getUTCMonth() + 1,
          day: date.getUTCDate(),
          hour: date.getUTCHours(),
          minute: date.getUTCMinutes(),
          second: date.getUTCSeconds(),
          day_of_week: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][date.getUTCDay()],
        },
      } : { input: raw, error: "Could not parse timestamp" },
      tags: ["timestamp", "utility", "decoder"],
    };
  },
};

function getRelativeTime(date: Date): string {
  const diff = Date.now() - date.getTime();
  const abs = Math.abs(diff);
  const future = diff < 0;
  const units: [number, string][] = [
    [31536000000, "year"], [2592000000, "month"], [86400000, "day"],
    [3600000, "hour"], [60000, "minute"], [1000, "second"],
  ];
  for (const [ms, unit] of units) {
    const val = Math.floor(abs / ms);
    if (val >= 1) return `${val} ${unit}${val > 1 ? "s" : ""} ${future ? "from now" : "ago"}`;
  }
  return "just now";
}

export const allTools: ToolDefinition[] = [
  localPlateOcr,
  geofenceMonitor,
  usernameSearch,
  domainIntel,
  emailHeaderAnalysis,
  imageMetadata,
  timestampDecoder,
  ...extraTools,
  ...marketplaceLocalTools,
  ...publicRecordTools,
  ...marketplaceRemoteTools.filter(tool=>!['lpr','public-records','vehicle-lookup'].includes(tool.id)),
];
