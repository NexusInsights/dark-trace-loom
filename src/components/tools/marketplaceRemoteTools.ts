import { Brain, Building2, Camera, Database, FileSearch, Globe, Landmark, Languages, MapPin, MessageCircle, Phone, Plane, Radio, Search, Shield, Ship, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { edgeFunctionError } from "@/lib/edgeFunctionError";
import type { ToolDefinition, ToolField } from "./types";

export interface MarketplaceProviderStatus {
  configured: boolean;
  missing_secrets: string[];
  source: string;
  coverage: string;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

async function invokeMarketplace(action: string, params: Record<string, unknown>, timeoutMs: number): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const { data, error } = await supabase.functions.invoke("osint-tools", { body: { action, params }, signal: controller.signal });
    if (error) throw await edgeFunctionError(error);
    const response = record(data);
    if (!response || !Object.keys(response).length) throw new Error("Marketplace integration returned no usable response");
    const message = typeof response.error === "string" ? response.error : record(response.error)?.message;
    if (message || ["error", "failed", "not_configured", "unknown_tool", "unavailable", "provider_configuration_required", "configuration_required", "unsupported"].includes(String(response.status).toLowerCase())) {
      throw new Error(String(message || response.reason || "Marketplace provider request failed"));
    }
    return response;
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`Marketplace ${action === "marketplace-status" ? "configuration check" : "provider request"} timed out; no automatic retry was made`);
    throw error;
  } finally { clearTimeout(timer); }
}

async function getBackendMarketplaceStatuses(): Promise<Record<string, MarketplaceProviderStatus>> {
  const data = await invokeMarketplace("marketplace-status", {}, 15000);
  const statuses = record(data.tools);
  if (!statuses) throw new Error("Marketplace configuration endpoint is unavailable or returned an invalid response");
  const result: Record<string, MarketplaceProviderStatus> = Object.create(null);
  for (const [slug, value] of Object.entries(statuses)) {
    const entry = record(value);
    if (!entry || typeof entry.configured !== "boolean" || !Array.isArray(entry.missing_secrets) || entry.missing_secrets.some(key => typeof key !== "string")) {
      throw new Error(`Marketplace configuration for ${slug} is invalid; execution remains blocked`);
    }
    result[slug] = {
      configured: entry.configured,
      missing_secrets: entry.missing_secrets as string[],
      source: typeof entry.source === "string" ? entry.source : typeof entry.provider === "string" ? entry.provider : "",
      coverage: typeof entry.coverage === "string" ? entry.coverage : typeof entry.scope === "string" ? entry.scope : "",
    };
  }
  return result;
}

export async function getMarketplaceStatuses(): Promise<Record<string, MarketplaceProviderStatus>> {
  const [backend, tcp, plate] = await Promise.allSettled([getBackendMarketplaceStatuses(), getPortScanStatus(), getPlateStatus()]);
  if (backend.status === "rejected") throw backend.reason;
  const result = backend.value;
  result["port-scanner-pro"] = tcp.status === "fulfilled" ? tcp.value : { configured: false, missing_secrets: [], source: "Cloudflare TCP sockets", coverage: tcp.reason instanceof Error ? tcp.reason.message : "TCP worker configuration is unavailable" };
  result['vehicle-lookup'] = plate.status === 'fulfilled' ? plate.value : { configured: false, missing_secrets: [], source: 'CarsXE Pages integration', coverage: plate.reason instanceof Error ? plate.reason.message : 'Plate access could not be verified' };
  result['public-records'] = { configured: true, missing_secrets: [], source: 'CourtListener public search', coverage: 'Credential-free public federal docket and opinion queries; coverage is checked on execution.' };
  result['property-records'] = { configured: true, missing_secrets: [], source: 'Official county parcels', coverage: 'Credential-free Travis and Williamson County property records.' };
  return result;
}

export async function getMarketplaceStatus(slug: string): Promise<MarketplaceProviderStatus> {
  if (slug === "port-scanner-pro") return getPortScanStatus();
  if (slug === 'public-records') return { configured: true, missing_secrets: [], source: 'CourtListener public search', coverage: 'Credential-free public search; source availability and coverage are checked on execution.' };
  if (slug === 'vehicle-lookup') return getPlateStatus();
  const statuses = await getBackendMarketplaceStatuses();
  if (!Object.prototype.hasOwnProperty.call(statuses, slug)) throw new Error(`No deployed marketplace integration is registered for ${slug}`);
  return statuses[slug];
}

async function getPlateStatus(): Promise<MarketplaceProviderStatus> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new Error('Sign in to check the connected plate source.');
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch('/api/person-records', { headers: { Authorization: `Bearer ${data.session.access_token}` }, signal: controller.signal, credentials: 'same-origin' });
    const result = await response.json();
    if (!response.ok || typeof result?.configured !== 'boolean' || !Array.isArray(result.missing_secrets)) throw new Error(result?.error || 'Plate source access could not be verified.');
    return result;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Plate source access check timed out.');
    throw error;
  } finally { clearTimeout(timer); }
}

async function portScanRequest(method: "GET" | "POST", body?: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(`Sign-in session could not be checked: ${error.message}`);
  const token = data.session?.access_token;
  if (!token) throw new Error("Sign in to check or run the authorized TCP worker");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch("/api/marketplace-port-scan", {
      method, headers: { Authorization: `Bearer ${token}`, ...(method === "POST" ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: controller.signal, credentials: "same-origin",
    });
    let value: unknown;
    try { value = await response.json(); }
    catch { throw new Error(`TCP worker returned HTTP ${response.status} with invalid JSON; verify its deployment`); }
    const output = record(value);
    if (!response.ok || !output || output.error) throw new Error(String(output?.error || output?.reason || `TCP worker HTTP ${response.status}`));
    return output;
  } catch (error) {
    if (controller.signal.aborted) throw new Error("TCP worker request timed out; no automatic scan retry was made");
    throw error;
  } finally { clearTimeout(timer); }
}

async function getPortScanStatus(): Promise<MarketplaceProviderStatus> {
  const status = await portScanRequest("GET");
  if (typeof status.configured !== "boolean" || !Array.isArray(status.missing_config) || status.missing_config.some(value => typeof value !== "string")) throw new Error("TCP worker configuration response is invalid; scanning remains blocked");
  return { configured: status.configured, missing_secrets: status.missing_config as string[], source: "Cloudflare TCP sockets", coverage: typeof status.coverage === "string" ? status.coverage : "Only explicitly authorized server-allowlisted public IPv4 targets can be probed" };
}

interface RemoteConfig {
  id: string;
  name: string;
  provider: string;
  scope: string;
  category: string;
  icon: ToolDefinition["icon"];
  fields: ToolField[];
  requiredSecrets?: string[];
}

const field = (key: string, label: string, required = true, placeholder?: string): ToolField => ({ key, label, required, placeholder });
const text = (key: string, label: string, required = true): ToolField => ({ key, label, required, type: "textarea" });
const select = (key: string, label: string, values: string[]): ToolField => ({ key, label, type: "select", options: values.map(value => ({ value, label: value })) });
const ipField = field("ip", "IPv4 Address", true, "8.8.8.8");
const urlField = field("url", "Public Profile / Page URL", true, "https://...");
const companyFields = [field("company", "SEC Company Name or Ticker", false, "AAPL"), field("cik", "SEC CIK (optional)", false), field("limit", "Maximum Companies (1–5)", false, "3")];

function remoteTool(config: RemoteConfig): ToolDefinition {
  return {
    id: config.id, name: config.name, description: config.scope, icon: config.icon, category: config.category,
    fields: config.fields,
    integration: { provider: config.provider, scope: config.scope, requiredSecrets: config.requiredSecrets },
    process: async inputs => {
      const details = await invokeMarketplace("marketplace-run", { tool: config.id, inputs }, 60000);
      return {
        summary: `${config.name}: provider result received${details.status === "partial" ? " with partial coverage" : ""}`,
        details: { ...details, implementation_scope: config.scope }, tags: ["marketplace", "provider-data"],
      };
    },
  };
}

const configs: RemoteConfig[] = [
  { id: "flight-tracking", name: "Flight Tracking — ADS-B Snapshot", provider: "ADSB.lol", scope: "Retrieve current ADS-B aircraft observations around coordinates; receiver coverage varies and historical paths are not supplied", category: "Geospatial", icon: Plane, fields: [field("latitude", "Latitude"), field("longitude", "Longitude"), field("radius_nm", "Radius in Nautical Miles (1–250)", false, "25")] },
  { id: "shodan-integration", name: "Shodan Host Intelligence", provider: "Shodan", scope: "Retrieve passive provider-recorded host, port and vulnerability observations for one IPv4 address using configured licensed access", category: "Reconnaissance", icon: Shield, requiredSecrets: ["SHODAN_API_KEY or authorized SHODAN_INTERNETDB_LICENSED"], fields: [ipField] },
  { id: "reverse-ip", name: "Reverse IP Lookup", provider: "HackerTarget", scope: "Retrieve provider-associated domains for an IPv4 address; records do not establish current co-hosting", category: "Reconnaissance", icon: Globe, fields: [ipField] },
  { id: "cve-tracker", name: "CVE Search — NVD", provider: "NIST NVD", scope: "Search actual NVD CVE records by CVE ID or product keyword at execution time", category: "Threat Intelligence", icon: Shield, fields: [field("keyword", "CVE ID or Product Keyword", true, "CVE-2024-3094")] },
  { id: "threat-feed", name: "Threat Feed — CISA / Feodo", provider: "CISA KEV and Feodo Tracker", scope: "Retrieve two real public feeds: CISA known exploited vulnerabilities and Feodo botnet C2 addresses", category: "Threat Intelligence", icon: Radio, fields: [field("keyword", "CISA Keyword Filter (optional)", false)] },
  { id: "ip-reputation", name: "IP Reputation — Feodo Check", provider: "Feodo Tracker", scope: "Check a supplied IPv4 address against the live Feodo botnet C2 list; no match does not establish safety", category: "Threat Intelligence", icon: Shield, fields: [ipField] },
  { id: "crypto-wallet-tracer", name: "Bitcoin Wallet Transactions", provider: "Blockstream", scope: "Retrieve real Bitcoin mainnet address statistics and transactions; ownership attribution is not supplied", category: "Financial", icon: Wallet, fields: [field("address", "Bitcoin Mainnet Address")] },
  { id: "blockchain-tracer", name: "Bitcoin Blockchain Transactions", provider: "Blockstream", scope: "Inspect real Bitcoin mainnet transactions and recorded counterparties; other chains and identity attribution are outside this integration", category: "Financial", icon: Wallet, fields: [field("address", "Bitcoin Mainnet Address")] },
  { id: "phishing-detector", name: "Lookalike Domain DNS Check", provider: "Google Public DNS", scope: "Check generated deletion/transposition domain candidates against live DNS; name similarity and DNS resolution do not prove phishing", category: "Threat Intelligence", icon: Shield, fields: [field("domain", "Domain", true, "example.com")] },
  { id: "vin-decoder", name: "VIN Decoder — NHTSA", provider: "NHTSA vPIC", scope: "Decode manufacturer-reported vehicle specifications from a VIN; ownership, title, accident and theft histories are not provided", category: "Vehicle", icon: FileSearch, fields: [field("vin", "17-Character VIN")] },
  { id: "sanctions-screening", name: "Sanctions Candidate Screening", provider: "OFAC, UN and EU public lists", scope: "Search actual sanctions datasets for candidate name matches; identity review and complete coverage are required before a sanctions decision", category: "Financial", icon: Landmark, fields: [field("name", "Person or Entity Name"), select("lists", "Lists", ["all", "ofac", "un", "eu"]), field("limit", "Maximum Candidates (1–100)", false, "25")] },
  { id: "corporate-records", name: "Corporate Records — SEC EDGAR", provider: "US SEC EDGAR", scope: "Retrieve SEC filer business details and securities filings; state incorporation registries and beneficial ownership are not covered", category: "Financial", icon: Building2, fields: companyFields },
  { id: "insider-tracker", name: "Insider Filings — SEC EDGAR", provider: "US SEC EDGAR", scope: "Retrieve real SEC ownership filings and reported transactions for a supplied issuer; filings are issuer-reported records", category: "Financial", icon: Landmark, fields: companyFields },
  { id: "satellite-search", name: "Satellite Imagery Catalog", provider: "Element 84 Earth Search STAC", scope: "Find archived satellite/aerial scenes, dates, coverage and asset URLs; this does not identify people or infer activity", category: "Geospatial", icon: MapPin, fields: [field("latitude", "Latitude", false), field("longitude", "Longitude", false), field("radius_km", "Radius in Kilometers (0.1–100)", false, "5"), field("bbox", "Bounding Box (optional west,south,east,north)", false), select("collection", "Imagery Collection", ["sentinel-2-l2a", "sentinel-2-c1-l2a", "landsat-c2-l2", "sentinel-1-grd", "naip"]), field("datetime", "Date or Date Range (optional)", false, "2026-01-01/2026-10-12"), field("max_cloud_cover", "Maximum Cloud Cover (0–100)", false, "100"), field("limit", "Maximum Scenes (1–25)", false, "10")] },
  // These are requirements shared by both server authentication modes. The
  // read-only backend status decides whether a static AI_API_KEY is required;
  // supabase_user mode authenticates with the existing sign-in session instead.
  { id: "sentiment-analysis", name: "Sentiment / Topic Analysis", provider: "Independent AI provider", scope: "Submit supplied text to a trained language model for a labelled sentiment/topic assessment; model interpretation is not a fact or certainty", category: "Analysis", icon: Brain, requiredSecrets: ["AI_CHAT_COMPLETIONS_URL", "AI_MODEL"], fields: [text("text", "Text to Analyze")] },
  { id: "translation", name: "Language Translation", provider: "Independent AI provider", scope: "Translate supplied text using a trained language model; specialist or consequential wording requires review", category: "Analysis", icon: Languages, requiredSecrets: ["AI_CHAT_COMPLETIONS_URL", "AI_MODEL"], fields: [text("text", "Source Text"), field("target_language", "Target Language", true, "English")] },
  { id: "pastebin-monitor", name: "Email Paste Exposure Lookup", provider: "Have I Been Pwned", scope: "Retrieve existing HIBP paste exposure records for an email at request time; this is a snapshot lookup, not continuous monitoring", category: "Threat Intelligence", icon: Database, requiredSecrets: ["HIBP_API_KEY"], fields: [field("email", "Email Address")] },
  ...[
    ["linkedin-harvester", "LinkedIn Public Page Snapshot", "LinkedIn"],
    ["reddit-profiler", "Reddit Public Page Snapshot", "Reddit"],
    ["instagram-osint", "Instagram Public Page Snapshot", "Instagram"],
    ["tiktok-tracker", "TikTok Public Page Snapshot", "TikTok"],
    ["social-media-scanner", "Social Public Page Snapshot", "supported social platform"],
  ].map(([id, name, platform]) => ({ id, name, provider: "Firecrawl", scope: `Retrieve accessible public ${platform} page content and source metadata; private content, identity attribution and continuous monitoring are not supplied`, category: "Social", icon: MessageCircle, requiredSecrets: ["FIRECRAWL_API_KEY"], fields: [urlField] })),
  { id: "lpr", name: "License Plate Image Recognition", provider: "CarsXE", scope: "Read plate candidates from a supplied public vehicle image using the configured provider; recognition does not establish ownership", category: "Vehicle", icon: Camera, requiredSecrets: ["CARSXE_API_KEY"], fields: [field("image_url", "Public HTTPS Vehicle Image URL")] },
  { id: "caller-id", name: "Caller ID Provider Lookup", provider: "Twilio Lookup", scope: "Retrieve US CNAM caller-name fields actually returned by Twilio; coverage depends on number region and licensed access", category: "Communications", icon: Phone, requiredSecrets: ["TWILIO_API_KEY", "TWILIO_API_SECRET"], fields: [field("phone", "International Phone Number", true, "+14155552671")] },
  { id: "sms-detector", name: "Phone Line Type Intelligence", provider: "Twilio Lookup", scope: "Retrieve provider-supplied line-type/carrier intelligence; disposable status and active SMS service are not inferred", category: "Communications", icon: Phone, requiredSecrets: ["TWILIO_API_KEY", "TWILIO_API_SECRET"], fields: [field("phone", "International Phone Number", true, "+14155552671")] },
  { id: "vehicle-lookup", name: "Vehicle Plate Provider Lookup", provider: "CarsXE", scope: "Retrieve vehicle fields actually supplied by a licensed plate-data provider; ownership and complete history are not assumed", category: "Vehicle", icon: FileSearch, requiredSecrets: ["CARSXE_API_KEY"], fields: [field("plate", "License Plate"), field("state", "State / Region"), field("country", "Country (optional)", false, "US")] },
  { id: "public-records", name: "Court Opinion Search", provider: "CourtListener", scope: "Search actual indexed court opinions; nationwide criminal, property and comprehensive person records are not supplied", category: "Records", icon: Landmark, requiredSecrets: ["COURTLISTENER_API_TOKEN"], fields: [field("q", "Court Opinion Search Query"), field("size", "Maximum Results (1–25)", false, "10")] },
  { id: "telegram-monitor", name: "Telegram Channel Monitor", provider: "Telegram public channel pages", scope: "Read sourced public messages with published IDs, dates, archive pagination and cursors; configure ongoing checks in Continuous Monitoring", category: "Social", icon: MessageCircle, requiredSecrets: [], fields: [field("url", "Public Channel URL", true, "https://t.me/s/telegram"), field("after_post_id", "Stored post cursor (optional)", false), field("max_pages", "Maximum source pages (1–10)", false, "2")] },
  { id: "streetview-compare", name: "Street View Comparator", provider: "KartaView", scope: "Compare actual dated KartaView images near coordinates, with side-by-side source photos and elapsed time; Google and Mapillary access are separate", category: "Geospatial", icon: MapPin, requiredSecrets: [], fields: [field("latitude", "Latitude", true), field("longitude", "Longitude", true), field("before_year", "Before year (optional)", false), field("after_year", "After year (optional)", false)] },
  { id: "twitter-deep-search", name: "X / Twitter Search", provider: "X API", scope: "Search public posts using the configured X API access tier; historical coverage and fields depend on licensed access", category: "Social", icon: MessageCircle, requiredSecrets: ["X_API_BEARER_TOKEN"], fields: [field("q", "Search Query"), select("mode", "Search Window", ["recent", "all"]), field("size", "Maximum Posts (10–25)", false, "10")] },
  { id: "discord-intel", name: "Discord Authorized Channel Messages", provider: "Discord API", scope: "Retrieve messages from a channel accessible to the configured Discord bot; private or unauthorized channels are unavailable", category: "Social", icon: MessageCircle, requiredSecrets: ["DISCORD_BOT_TOKEN"], fields: [field("channel_id", "Authorized Channel ID"), field("size", "Maximum Messages (1–25)", false, "10")] },
  { id: "malware-sandbox", name: "Malware Hash Report", provider: "VirusTotal", scope: "Retrieve an existing VirusTotal file report by hash; no file upload, detonation or new sandbox execution is performed", category: "Threat Intelligence", icon: Shield, requiredSecrets: ["VIRUSTOTAL_API_KEY"], fields: [field("hash", "MD5 / SHA-1 / SHA-256 File Hash")] },
  { id: "vessel-tracker", name: "Vessel AIS Provider Lookup", provider: "AISStream", scope: "Retrieve available provider AIS observations for a vessel and bounding box; receiver coverage is incomplete", category: "Geospatial", icon: Ship, requiredSecrets: ["AISSTREAM_API_KEY"], fields: [field("mmsi", "Vessel MMSI (9 digits)"), field("bbox", "Bounding Box (minlon,minlat,maxlon,maxlat)")] },
  { id: "dark-web-monitor", name: "Organization Exposure Search", provider: "DarkOwl", scope: "Search licensed exposure-index records for an organization/domain; private-person searches and continuous monitoring are outside this integration", category: "Threat Intelligence", icon: Search, requiredSecrets: ["DARKOWL_PUBLIC_KEY", "DARKOWL_PRIVATE_KEY"], fields: [field("q", "Organization / Domain Search"), field("size", "Maximum Results (1–25)", false, "10")] },
];

const imageGeolocation: ToolDefinition = {
  id: "geolocation-analyzer", name: "Image EXIF Geolocation", category: "Geospatial", icon: MapPin,
  description: "Read GPS coordinates and metadata actually embedded in a supplied image; no location is inferred when GPS is absent",
  fields: [{ key: "image_base64", label: "Image File", type: "file", fileEncoding: "base64", accept: "image/jpeg,image/tiff,image/png,image/webp", maxFileBytes: 8 * 1024 * 1024, required: true, filenameKey: "filename" }],
  process: async inputs => {
    const base64 = (inputs.image_base64 || "").trim();
    if (!base64 || base64.length > Math.ceil(8 * 1024 * 1024 * 4 / 3)) throw new Error("Select an image no larger than 8 MiB");
    let bytes: Uint8Array;
    try { bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0)); }
    catch { throw new Error("Uploaded image could not be decoded"); }
    const { default: exifr } = await import("exifr");
    let metadata: Record<string, unknown> | undefined;
    try { metadata = await exifr.parse(bytes, { gps: true, tiff: true, exif: true, iptc: true, icc: false }); }
    catch (error) { throw new Error(`Image metadata could not be parsed: ${error instanceof Error ? error.message : "Unsupported or damaged image"}`); }
    const latitude = metadata?.latitude;
    const longitude = metadata?.longitude;
    const gps = typeof latitude === "number" && typeof longitude === "number" && Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 ? { latitude, longitude } : null;
    return {
      summary: gps ? `Embedded GPS coordinates: ${gps.latitude}, ${gps.longitude}` : "No valid GPS coordinates were supplied in the image metadata",
      details: { source: inputs.filename || "supplied image bytes", size_bytes: bytes.length, embedded_gps: gps, metadata: metadata || null, note: "Only embedded metadata is reported. Missing GPS remains unknown. EXIF can be edited; coordinates do not independently establish where or when the image was taken. No face, person or activity identification is performed." }, tags: ["image", "exif", "geolocation", "local"],
    };
  },
};

const portScannerPro: ToolDefinition = {
  id: "port-scanner-pro", name: "Authorized TCP Port Probe", category: "Reconnaissance", icon: Shield,
  description: "Probe up to 10 TCP ports on an explicitly authorized server-allowlisted public IPv4 target; results report actual connection observations",
  integration: { provider: "Cloudflare TCP sockets", scope: "Active TCP connects only to exact public IPv4 targets in the server allowlist. No UDP, OS detection, service fingerprints or inferred closed-port results.", requiredSecrets: ["PORTSCAN_ALLOWED_IPS"] },
  fields: [ipField, field("ports", "TCP Ports (comma separated, maximum 10)", true, "80,443"), { key: "authorization_confirmed", label: "Target Authorization", type: "select", required: true, options: [{ value: "false", label: "Choose only if you own this target or have explicit permission" }, { value: "true", label: "I own this target or have explicit permission for these probes" }] }],
  process: async inputs => {
    if (inputs.authorization_confirmed !== "true") throw new Error("Explicit authorization for this target and these TCP probes is required");
    const details = await portScanRequest("POST", { ip: inputs.ip, ports: inputs.ports, authorization_confirmed: true });
    if (!Array.isArray(details.ports) || typeof details.source !== "string") throw new Error("TCP worker returned no valid port observations");
    return { summary: `${details.ports.length} TCP connection observations for ${inputs.ip}; read each recorded status`, details, tags: ["tcp", "authorized-target", "observed-data"] };
  },
};

export const marketplaceRemoteTools: ToolDefinition[] = [...configs.map(remoteTool), imageGeolocation, portScannerPro];
