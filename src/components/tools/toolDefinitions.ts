import { ToolDefinition, ToolResult } from "./types";
import { Globe, User, Mail, Image, Clock } from "lucide-react";
import { extraTools } from "./extraTools";
import { supabase } from "@/integrations/supabase/client";

async function runOsint<T = Record<string, unknown>>(action: string, params: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("osint-tools", { body: { action, params } });
  if (error) throw new Error(error.message || `${action} failed`);
  if (data?.error) throw new Error(data.error);
  return data as T;
}

// ─── 1. Username Search ───
const usernamePlatforms = [
  "GitHub", "Twitter/X", "Reddit", "Instagram", "LinkedIn",
  "TikTok", "YouTube", "Pinterest", "Telegram", "Discord",
  "Medium", "Dev.to", "Keybase", "HackerOne", "Steam",
];

const usernameSearch: ToolDefinition = {
  id: "username-search",
  name: "Username Search",
  description: "Live-check a username across 15+ platforms via real HTTP probes",
  icon: User,
  category: "Identity",
  fields: [
    { key: "username", label: "Username", placeholder: "e.g. john_doe_42", required: true },
  ],
  process: async (inputs) => {
    const username = inputs.username.trim();
    const data = await runOsint<{ total_found: number; total_checked: number }>("username-search", { username });
    return {
      summary: `Found "${username}" on ${data.total_found}/${data.total_checked} platforms`,
      details: data, tags: ["identity", "username", "social-media"],
    };
  },
};

// ─── 2. Domain Intelligence ───
const domainIntel: ToolDefinition = {
  id: "domain-intel",
  name: "Domain Intelligence",
  description: "Combined WHOIS/RDAP + DNS + IP geolocation for a domain",
  icon: Globe,
  category: "Reconnaissance",
  fields: [
    { key: "domain", label: "Domain", placeholder: "e.g. example.com", required: true },
  ],
  process: async (inputs) => {
    const domain = inputs.domain.trim().replace(/^https?:\/\//, "").split("/")[0];
    const [whois, dns] = await Promise.all([
      runOsint("whois", { domain }).catch((e) => ({ error: e.message })),
      runOsint<{ a?: string[] }>("dns-query", { domain }).catch((e) => ({ error: (e as Error).message })),
    ]);
    let hosting: unknown = null;
    const a = (dns as { a?: string[] }).a;
    if (a && a[0]) {
      hosting = await runOsint("ip-geo", { ip: a[0] }).catch((e) => ({ error: (e as Error).message }));
    }
    return {
      summary: `Intelligence gathered for ${domain}`,
      details: { domain, whois, dns, hosting },
      tags: ["domain", "dns", "whois"],
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
    await new Promise((r) => setTimeout(r, 700));

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
          spf: spfPass ? "PASS" : "FAIL/MISSING",
          dkim: dkimPass ? "PASS" : "FAIL/MISSING",
          dmarc: dmarcPass ? "PASS" : "FAIL/MISSING",
        },
        risk_indicators: [
          ...(!spfPass ? ["SPF check failed – possible spoofing"] : []),
          ...(!dkimPass ? ["DKIM not verified"] : []),
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
  description: "Fetch an image and extract real EXIF metadata (camera, GPS, dates)",
  icon: Image,
  category: "Media",
  fields: [
    { key: "image_url", label: "Image URL", placeholder: "https://example.com/photo.jpg", required: true },
    { key: "notes", label: "Notes", type: "textarea", placeholder: "Additional context..." },
  ],
  process: async (inputs) => {
    const url = inputs.image_url.trim();
    // Fetch image bytes client-side and parse EXIF with exifr (lightweight)
    const { default: exifr } = await import("exifr");
    let buf: ArrayBuffer;
    try {
      const r = await fetch(url, { mode: "cors" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      buf = await r.arrayBuffer();
    } catch (e) {
      throw new Error(`Could not fetch image: ${(e as Error).message}. The host may block CORS — try a direct image URL.`);
    }
    const meta = await exifr.parse(buf, { gps: true, tiff: true, exif: true, iptc: true, icc: false }).catch(() => null);
    const size = buf.byteLength;
    return {
      summary: meta ? `EXIF extracted (${(size / 1024).toFixed(1)} KB)` : `No EXIF found (${(size / 1024).toFixed(1)} KB)`,
      details: {
        source_url: url,
        size_bytes: size,
        exif: meta || null,
        geolocation: meta?.latitude ? { latitude: meta.latitude, longitude: meta.longitude } : null,
        notes: inputs.notes || null,
      },
      tags: ["image", "exif", "metadata", ...(meta?.latitude ? ["geolocation"] : [])],
    };
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
    await new Promise((r) => setTimeout(r, 300));

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
  usernameSearch,
  domainIntel,
  emailHeaderAnalysis,
  imageMetadata,
  timestampDecoder,
  ...extraTools,
];
