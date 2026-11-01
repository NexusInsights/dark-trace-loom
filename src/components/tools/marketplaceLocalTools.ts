import { FileSearch, Mail, Network, UserRound } from "lucide-react";
import type { ToolDefinition, ToolResult } from "./types";
import { analyzePacketCapture } from "./packetForensics";
import { analyzeDnsLog } from "./dnsLogForensics";

const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 25 * 1024 * 1024;
const MAX_PART_BYTES = 4 * 1024 * 1024;
const MAX_HAR_CHARS = 10 * 1024 * 1024;

function requiredText(value: string | undefined, label: string, max = 200): string {
  const text = (value || "").trim();
  if (!text || text.length > max) throw new Error(`${label} is required and must be at most ${max} characters`);
  return text;
}

function nameToken(value: string | undefined, label: string): string {
  const text = requiredText(value, label, 100);
  if (!/^[\p{L}\p{M}\s'.-]+$/u.test(text)) throw new Error(`${label} must contain name characters only`);
  const token = text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z]/g, "");
  if (!token) throw new Error(`${label} needs a Latin-letter spelling for these candidate patterns`);
  return token;
}

function namePatterns(first: string, last: string): string[] {
  return [...new Set([
    first, last, `${first}${last}`, `${last}${first}`,
    `${first}.${last}`, `${first}_${last}`, `${first}-${last}`,
    `${last}.${first}`, `${last}_${first}`, `${last}-${first}`,
    `${first[0]}${last}`, `${first[0]}.${last}`, `${first}${last[0]}`,
    `${first}.${last[0]}`, `${first[0]}${last[0]}`,
  ])];
}

const usernamePermutator: ToolDefinition = {
  id: "username-permutator",
  name: "Username Permutator",
  description: "Generate explicit search candidates from supplied names and suffixes; use Username Search to check public accounts",
  icon: UserRound,
  category: "Identity",
  fields: [
    { key: "first_name", label: "First Name", required: true },
    { key: "last_name", label: "Last Name", required: true },
    { key: "suffixes", label: "Known Suffixes (optional, comma separated)", placeholder: "Known numbers or short strings, up to 10" },
  ],
  process: async (inputs) => {
    const first = nameToken(inputs.first_name, "First name");
    const last = nameToken(inputs.last_name, "Last name");
    const suffixes = (inputs.suffixes || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
    if (suffixes.length > 10 || suffixes.some(s => !/^[a-z0-9]{1,12}$/.test(s))) {
      throw new Error("Supply up to 10 alphanumeric suffixes, each at most 12 characters");
    }
    const bases = namePatterns(first, last);
    const candidates = [...new Set([...bases, ...suffixes.flatMap(suffix => bases.map(base => `${base}${suffix}`))])];
    return {
      summary: `${candidates.length} generated username search candidates; account existence has not been checked`,
      details: {
        operation: "deterministic_name_permutation", normalized_name: { first, last },
        suffixes_supplied: suffixes, candidates,
        verified_accounts: [], verification_status: "not_checked",
        note: "Every candidate is generated from your input. These are search terms, not discovered accounts or evidence of common ownership. No dates, numbers or personal facts were inferred.",
      }, tags: ["username", "candidates", "local"],
    };
  },
};

const emailPermutator: ToolDefinition = {
  id: "email-permutator",
  name: "Email Permutator",
  description: "Generate candidate email addresses at a supplied domain; generated addresses are explicitly unverified",
  icon: Mail,
  category: "Communications",
  fields: [
    { key: "first_name", label: "First Name", required: true },
    { key: "last_name", label: "Last Name", required: true },
    { key: "domain", label: "Email Domain", placeholder: "example.com", required: true },
  ],
  process: async (inputs) => {
    const first = nameToken(inputs.first_name, "First name");
    const last = nameToken(inputs.last_name, "Last name");
    const domainInput = requiredText(inputs.domain, "Domain", 253).toLowerCase();
    if (/[/\\:@?#\s]/.test(domainInput)) throw new Error("Supply only the email domain, without a URL, username, port or path");
    let domain: string;
    try { domain = new URL(`https://${domainInput}`).hostname; }
    catch { throw new Error("The email domain is invalid"); }
    if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) {
      throw new Error("Supply a valid public email domain such as example.com");
    }
    const candidates = namePatterns(first, last).map(localPart => `${localPart}@${domain}`);
    return {
      summary: `${candidates.length} generated email candidates at ${domain}; mailbox existence and ownership are unverified`,
      details: {
        operation: "deterministic_email_permutation", domain, candidates,
        verified_addresses: [], verification_status: "not_checked",
        note: "These candidate strings are generated, not sourced contact records. DNS, SMTP and delivery are not checked. Use licensed person enrichment for actual supplied email addresses.",
      }, tags: ["email", "candidates", "local"],
    };
  },
};

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function metric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function increment(counts: Record<string, number>, key: string): void {
  counts[key] = (Object.prototype.hasOwnProperty.call(counts, key) ? counts[key] : 0) + 1;
}

export function analyzeHar(raw: string): ToolResult {
  const text = requiredText(raw, "HAR JSON", MAX_HAR_CHARS);
  let parsed: unknown;
  try { parsed = JSON.parse(text); }
  catch { throw new Error("The input is not valid JSON. Export a HAR file from your browser Network panel."); }
  const log = object(object(parsed)?.log);
  if (!log || !Array.isArray(log.entries)) throw new Error("Expected a HAR object containing log.entries");
  if (!log.entries.length || log.entries.length > 10000) throw new Error("HAR must contain between 1 and 10,000 request entries");
  const hosts: Record<string, number> = Object.create(null);
  const methods: Record<string, number> = Object.create(null);
  const statuses: Record<string, number> = Object.create(null);
  const rows = log.entries.map((entry: unknown, index: number) => {
    const item = object(entry);
    const request = object(item?.request);
    const response = object(item?.response);
    if (!item || !request || !response || typeof request.url !== "string" || typeof request.method !== "string") {
      throw new Error(`HAR entry ${index + 1} is missing its request URL, method or response`);
    }
    let url: URL;
    try { url = new URL(request.url); }
    catch { throw new Error(`HAR entry ${index + 1} has an invalid request URL`); }
    if (!["http:", "https:"].includes(url.protocol)) throw new Error(`HAR entry ${index + 1} uses an unsupported protocol; HTTP/HTTPS HAR entries are required`);
    if (typeof response.status !== "number" || !Number.isInteger(response.status) || response.status < 0 || response.status > 599) {
      throw new Error(`HAR entry ${index + 1} has an invalid HTTP status`);
    }
    const method = request.method.toUpperCase();
    if (!/^[A-Z]{1,20}$/.test(method)) throw new Error(`HAR entry ${index + 1} has an invalid HTTP method`);
    const content = object(response.content);
    increment(hosts, url.hostname); increment(methods, method); increment(statuses, String(response.status));
    return {
      entry: index + 1,
      started_at: typeof item.startedDateTime === "string" ? item.startedDateTime : null,
      method, url: `${url.origin}${url.pathname}`,
      query_parameter_names: [...new Set(url.searchParams.keys())],
      status: response.status,
      elapsed_ms: metric(item.time),
      request_body_bytes: metric(request.bodySize),
      response_body_bytes: metric(response.bodySize),
      content_bytes: metric(content?.size),
      mime_type: typeof content?.mimeType === "string" ? content.mimeType : null,
      server_ip: typeof item.serverIPAddress === "string" ? item.serverIPAddress : null,
      timings_ms: Object.fromEntries(Object.entries(object(item.timings) || {}).filter(([, value]) => typeof value === "number").map(([key, value]) => [key, metric(value)])),
    };
  });
  const knownElapsed = rows.map(row => row.elapsed_ms).filter((value): value is number => value !== null);
  const knownResponseBytes = rows.map(row => row.response_body_bytes).filter((value): value is number => value !== null);
  return {
    summary: `${rows.length} captured HTTP requests across ${Object.keys(hosts).length} hosts; ${rows.filter(row => row.status >= 400 || row.status === 0).length} error or failed request records`,
    details: {
      operation: "supplied_har_analysis", har_version: typeof log.version === "string" ? log.version : null,
      request_count: rows.length, hosts: { ...hosts }, methods: { ...methods }, statuses: { ...statuses },
      observed_server_ips: [...new Set(rows.map(row => row.server_ip).filter(Boolean))],
      observed_response_body_bytes: knownResponseBytes.reduce((sum, value) => sum + value, 0),
      requests_with_known_body_size: knownResponseBytes.length,
      max_observed_elapsed_ms: knownElapsed.length ? Math.max(...knownElapsed) : null,
      requests: rows,
      note: "All metrics come from the supplied HAR. Missing or negative HAR measurements remain null. HTTP errors do not prove attacks. This does not capture live traffic, decode PCAP or infer unseen network activity. Authentication headers, cookies, bodies and query values are excluded from this report.",
    }, tags: ["network", "har", "forensics", "local"],
  };
}

const networkForensics: ToolDefinition = {
  id: "network-forensics",
  name: "Network Forensics",
  description: "Analyze supplied PCAP/PCAPNG packets, Zeek/dig DNS logs, measured traffic patterns, or a browser HAR export",
  icon: Network,
  category: "Analysis",
  fields: [
    { key: "capture_base64", label: "PCAP or PCAPNG Capture (optional)", type: "file", fileEncoding: "base64", accept: ".pcap,.pcapng,.cap", maxFileBytes: 8 * 1024 * 1024, filenameKey: "capture_filename" },
    { key: "dns_upload", label: "DNS Log File (Zeek JSON/JSONL or dig text, optional)", type: "file", fileEncoding: "text", accept: ".log,.json,.jsonl,.txt", maxFileBytes: 8 * 1024 * 1024, filenameKey: "dns_filename" },
    { key: "dns_log", label: "DNS Log Text (optional)", type: "textarea", placeholder: "Paste actual Zeek DNS JSON/JSONL or complete dig output" },
    { key: "har_upload", label: "HAR Export File (optional)", type: "file", fileEncoding: "text", accept: ".har,.json,application/json", maxFileBytes: 8 * 1024 * 1024 },
    { key: "har_json", label: "HAR JSON (or paste browser Network export)", type: "textarea", placeholder: "Paste HAR JSON, or select a HAR file above" },
  ],
  process: async inputs => {
    const dns=inputs.dns_upload||inputs.dns_log,har=inputs.har_upload||inputs.har_json;
    if([inputs.capture_base64,dns,har].filter(value=>Boolean(value?.trim())).length!==1)throw new Error('Select one packet capture, DNS log, or HAR input for this run.');
    return inputs.capture_base64?analyzePacketCapture(inputs.capture_base64,inputs.capture_filename||'capture.pcap'):dns?analyzeDnsLog(dns,inputs.dns_filename||'supplied-dns.log'):analyzeHar(har);
  },
};

function decodeDocumentBase64(input: string): Uint8Array {
  const raw = requiredText(input, "Document base64", Math.ceil(MAX_DOCUMENT_BYTES * 4 / 3) + 1024);
  const data = raw.startsWith("data:") ? raw.slice(raw.indexOf(",") + 1) : raw;
  const base64 = data.replace(/\s/g, "");
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64) || !base64) {
    throw new Error("Document data is not valid standard base64");
  }
  if (base64.length > Math.ceil(MAX_DOCUMENT_BYTES * 4 / 3)) throw new Error("Document exceeds the 8 MiB analysis limit");
  let decoded: string;
  try { decoded = atob(base64); }
  catch { throw new Error("Document base64 could not be decoded"); }
  if (decoded.length > MAX_DOCUMENT_BYTES) throw new Error("Document exceeds the 8 MiB analysis limit");
  return Uint8Array.from(decoded, character => character.charCodeAt(0));
}

function latin1(bytes: Uint8Array): string {
  let output = "";
  for (let start = 0; start < bytes.length; start += 32768) output += String.fromCharCode(...bytes.subarray(start, start + 32768));
  return output;
}

function readPdfString(source: string, start: number): string | null {
  if (source[start] === "<" && source[start + 1] !== "<") {
    const end = source.indexOf(">", start + 1);
    if (end < 0 || end - start > 65536) return null;
    const hex = source.slice(start + 1, end).replace(/\s/g, "");
    if (!/^[\da-f]*$/i.test(hex)) return null;
    return decodePdfBytes(Uint8Array.from((hex.length % 2 ? `${hex}0` : hex).match(/.{2}/g) || [], pair => parseInt(pair, 16)));
  }
  if (source[start] !== "(") return null;
  const output: number[] = [];
  let depth = 1;
  for (let index = start + 1; index < source.length && output.length <= 65536; index++) {
    const character = source[index];
    if (character === "\\") {
      const next = source[++index];
      if (next === undefined) return null;
      if (next === "\r" || next === "\n") { if (next === "\r" && source[index + 1] === "\n") index++; continue; }
      if (/[0-7]/.test(next)) {
        const octal = source.slice(index).match(/^[0-7]{1,3}/)?.[0] || next;
        output.push(parseInt(octal, 8) & 255); index += octal.length - 1; continue;
      }
      const escapes: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12 };
      output.push(escapes[next] ?? next.charCodeAt(0)); continue;
    }
    if (character === "(") depth++;
    if (character === ")" && --depth === 0) return decodePdfBytes(new Uint8Array(output));
    // Only closing parentheses change depth downward; parentheses inside a string are preserved.
    if (character !== ")" || depth > 0) output.push(character.charCodeAt(0));
  }
  return null;
}

function decodePdfBytes(bytes: Uint8Array): string {
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    let text = "";
    for (let index = 2; index + 1 < bytes.length; index += 2) text += String.fromCharCode(bytes[index] * 256 + bytes[index + 1]);
    return text;
  }
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder().decode(bytes.subarray(3));
  // PDFDocEncoding differs from Latin-1 in these defined character slots.
  const special: Record<number, number> = {
    0x18: 0x02d8, 0x19: 0x02c7, 0x1a: 0x02c6, 0x1b: 0x02d9, 0x1c: 0x02dd, 0x1d: 0x02db, 0x1e: 0x02da, 0x1f: 0x02dc,
    0x80: 0x2022, 0x81: 0x2020, 0x82: 0x2021, 0x83: 0x2026, 0x84: 0x2014, 0x85: 0x2013, 0x86: 0x0192, 0x87: 0x2044,
    0x88: 0x2039, 0x89: 0x203a, 0x8a: 0x2212, 0x8b: 0x2030, 0x8c: 0x201e, 0x8d: 0x201c, 0x8e: 0x201d, 0x8f: 0x2018,
    0x90: 0x2019, 0x91: 0x201a, 0x92: 0x2122, 0x93: 0xfb01, 0x94: 0xfb02, 0x95: 0x0141, 0x96: 0x0152, 0x97: 0x0160,
    0x98: 0x0178, 0x99: 0x017d, 0x9a: 0x0131, 0x9b: 0x0142, 0x9c: 0x0153, 0x9d: 0x0161, 0x9e: 0x017e, 0xa0: 0x20ac,
  };
  return Array.from(bytes, value => String.fromCharCode(special[value] ?? value)).join("");
}

function xmlValues(xml: string): Record<string, string[]> {
  const document = new DOMParser().parseFromString(xml, "application/xml");
  if (document.querySelector("parsererror")) throw new Error("Document metadata XML is malformed");
  const values: Record<string, string[]> = Object.create(null);
  for (const element of Array.from(document.querySelectorAll("*"))) {
    if (element.children.length > 0) continue;
    const value = element.textContent?.trim();
    if (!value) continue;
    const key = element.tagName;
    (values[key] ||= []).push(value.slice(0, 10000));
  }
  return { ...values };
}

function inspectPdf(bytes: Uint8Array): Record<string, unknown> {
  const raw = latin1(bytes);
  const infoRefs = [...raw.matchAll(/\/Info\s+(\d+)\s+(\d+)\s+R\b/g)];
  const infoRef = infoRefs.at(-1);
  const metadata: Record<string, string> = {};
  let infoObject: string | null = null;
  if (infoRef) {
    const objectMatch = raw.match(new RegExp(`(?:^|[\\r\\n])${infoRef[1]}\\s+${infoRef[2]}\\s+obj\\b([\\s\\S]{0,65536}?)endobj`));
    infoObject = objectMatch?.[1] || null;
    if (infoObject) {
      for (const key of ["Title", "Author", "Subject", "Keywords", "Creator", "Producer", "CreationDate", "ModDate"]) {
        const valueMarker = new RegExp(`/${key}\\s+`).exec(infoObject);
        if (valueMarker) {
          const value = readPdfString(infoObject, valueMarker.index + valueMarker[0].length);
          if (value !== null) metadata[key] = value;
        }
      }
    }
  }
  const xmp = raw.match(/<(?:[\w.-]+:)?xmpmeta\b[\s\S]{0,1048576}?<\/(?:[\w.-]+:)?xmpmeta>/)?.[0];
  const links: string[] = [];
  for (const match of raw.matchAll(/\/URI\s+/g)) {
    const value = readPdfString(raw, match.index + match[0].length);
    if (value) links.push(value);
    if (links.length >= 200) break;
  }
  const markers = ["JavaScript", "JS", "OpenAction", "Launch", "EmbeddedFile", "Encrypt"];
  return {
    format: "PDF", pdf_version: raw.match(/^%PDF-([\d.]+)/)?.[1] || null,
    metadata, visible_xmp_metadata: xmp ? xmlValues(xmp) : null,
    info_reference_present: Boolean(infoRef), info_object_visible: Boolean(infoObject),
    visible_page_object_count: [...raw.matchAll(/\/Type\s*\/Page\b/g)].length,
    visible_uri_values: [...new Set(links)],
    observed_name_markers: markers.filter(marker => new RegExp(`/${marker}\\b`).test(raw)),
    limitations: "Metadata and markers are extracted from visible, uncompressed PDF objects. Compressed object streams, encrypted content and font-dependent text are not decoded. The visible page-object count is not a definitive page total. A marker does not establish malicious behavior, authorship or authenticity.",
  };
}

// Bound ZIP expansion before JSZip parses or decompresses OOXML parts.
function inspectZipDirectory(bytes: Uint8Array): { entries: { path: string; compressed_bytes: number; uncompressed_bytes: number }[]; expanded: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (view.getUint32(offset, true) === 0x06054b50 && offset + 22 + view.getUint16(offset + 20, true) === bytes.length) { end = offset; break; }
  }
  if (end < 0) throw new Error("Archive central directory is missing or truncated");
  const count = view.getUint16(end + 10, true);
  const centralSize = view.getUint32(end + 12, true);
  const centralOffset = view.getUint32(end + 16, true);
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || view.getUint16(end + 8, true) !== count) throw new Error("Multi-volume ZIP archives are not supported");
  if (count === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) throw new Error("ZIP64 archives are not supported by this bounded document parser");
  if (count > 2000 || centralOffset + centralSize > end) throw new Error("Archive exceeds the bounded directory limits");
  const entries: { path: string; compressed_bytes: number; uncompressed_bytes: number }[] = [];
  let offset = centralOffset;
  let expanded = 0;
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw new Error("Archive central directory is malformed");
    if (view.getUint16(offset + 8, true) & 1) throw new Error("Encrypted ZIP entries are not supported");
    const compressed = view.getUint32(offset + 20, true);
    const uncompressed = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (next > centralOffset + centralSize || compressed === 0xffffffff || uncompressed === 0xffffffff) throw new Error("Archive entry exceeds supported ZIP bounds");
    const path = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    if (!path || path.startsWith("/") || path.includes("\\") || path.split("/").includes("..")) throw new Error("Archive contains an unsafe or invalid part path");
    expanded += uncompressed;
    if (uncompressed > MAX_PART_BYTES || expanded > MAX_EXPANDED_BYTES) throw new Error("Document archive exceeds the 4 MiB per-part or 25 MiB expanded limit");
    if (entries.some(entry => entry.path === path)) throw new Error("Archive contains duplicate part paths");
    entries.push({ path, compressed_bytes: compressed, uncompressed_bytes: uncompressed });
    offset = next;
  }
  if (offset !== centralOffset + centralSize) throw new Error("Archive directory length does not match its declared entries");
  return { entries, expanded };
}

async function inspectOoxml(bytes: Uint8Array): Promise<Record<string, unknown>> {
  const directory = inspectZipDirectory(bytes);
  const { default: JSZip } = await import("jszip");
  let zip: Awaited<ReturnType<typeof JSZip.loadAsync>>;
  try { zip = await JSZip.loadAsync(bytes); }
  catch (error) { throw new Error(`Office document archive could not be read: ${error instanceof Error ? error.message : "Invalid ZIP"}`); }
  if (!zip.file("[Content_Types].xml")) throw new Error("ZIP is not an OOXML Office document; [Content_Types].xml is absent");
  const format = zip.file("word/document.xml") ? "Word OOXML" : zip.file("xl/workbook.xml") ? "Excel OOXML" : zip.file("ppt/presentation.xml") ? "PowerPoint OOXML" : null;
  if (!format) throw new Error("Archive is not a supported Word, Excel or PowerPoint document");
  async function readPart(path: string): Promise<string | null> {
    const file = zip.file(path);
    if (!file) return null;
    const declared = directory.entries.find(entry => entry.path === path);
    if (!declared) throw new Error(`Office part ${path} has no declared directory entry`);
    const content = await new Promise<Uint8Array>((resolve, reject) => {
      // JSZip documents internalStream, but its bundled TypeScript declarations omit it.
      type PartStream = {
        on(event: "data", callback: (chunk: Uint8Array) => void): PartStream;
        on(event: "error", callback: (error: Error) => void): PartStream;
        on(event: "end", callback: () => void): PartStream;
        pause(): PartStream;
        resume(): PartStream;
      };
      const streamFile = file as typeof file & { internalStream(type: "uint8array"): PartStream };
      if (typeof streamFile.internalStream !== "function") { reject(new Error("The installed archive parser does not support bounded streaming")); return; }
      const stream = streamFile.internalStream("uint8array");
      const chunks: Uint8Array[] = [];
      let total = 0;
      let finished = false;
      const timer = setTimeout(() => fail(new Error(`Office part ${path} exceeded the 15-second extraction timeout`)), 15000);
      function fail(error: Error) {
        if (finished) return;
        finished = true; clearTimeout(timer); stream.pause(); chunks.length = 0; reject(error);
      }
      stream.on("data", (chunk: Uint8Array) => {
        if (finished) return;
        total += chunk.length;
        if (total > MAX_PART_BYTES || total > declared.uncompressed_bytes) { fail(new Error(`Office part ${path} violates its declared size`)); return; }
        chunks.push(chunk);
      });
      stream.on("error", (error: Error) => fail(new Error(`Office part ${path} could not be decompressed: ${error.message}`)));
      stream.on("end", () => {
        if (finished) return;
        if (total !== declared.uncompressed_bytes) { fail(new Error(`Office part ${path} violates its declared size`)); return; }
        finished = true; clearTimeout(timer);
        const combined = new Uint8Array(total);
        let position = 0;
        for (const chunk of chunks) { combined.set(chunk, position); position += chunk.length; }
        resolve(combined);
      });
      stream.resume();
    });
    return new TextDecoder().decode(content);
  }
  const core = await readPart("docProps/core.xml");
  const app = await readPart("docProps/app.xml");
  const custom = await readPart("docProps/custom.xml");
  const namedCustomProperties: { name: string | null; value: string; type: string | null }[] = [];
  if (custom) {
    const document = new DOMParser().parseFromString(custom, "application/xml");
    if (document.querySelector("parsererror")) throw new Error("Custom property metadata is malformed XML");
    for (const property of Array.from(document.getElementsByTagNameNS("*", "property"))) {
      namedCustomProperties.push({ name: property.getAttribute("name"), value: property.textContent?.trim().slice(0, 10000) || "", type: property.firstElementChild?.tagName || null });
    }
  }
  const external: { part: string; id: string | null; type: string | null; target: string }[] = [];
  for (const entry of directory.entries.filter(entry => entry.path.endsWith(".rels"))) {
    const xml = await readPart(entry.path);
    if (!xml) continue;
    const document = new DOMParser().parseFromString(xml, "application/xml");
    if (document.querySelector("parsererror")) throw new Error(`Relationship part ${entry.path} is malformed XML`);
    for (const element of Array.from(document.getElementsByTagNameNS("*", "Relationship"))) {
      const target = element.getAttribute("Target");
      if (element.getAttribute("TargetMode") === "External" && target) external.push({ part: entry.path, id: element.getAttribute("Id"), type: element.getAttribute("Type"), target });
    }
  }
  const textPaths = directory.entries.filter(entry => /^(?:word\/document\.xml|xl\/sharedStrings\.xml|ppt\/slides\/slide\d+\.xml)$/.test(entry.path));
  const excerpts: { part: string; text: string; truncated: boolean }[] = [];
  for (const entry of textPaths.slice(0, 20)) {
    const xml = await readPart(entry.path);
    if (!xml) continue;
    const document = new DOMParser().parseFromString(xml, "application/xml");
    if (document.querySelector("parsererror")) throw new Error(`Text part ${entry.path} is malformed XML`);
    const text = Array.from(document.getElementsByTagNameNS("*", "t")).map(element => element.textContent || "").join(" ");
    excerpts.push({ part: entry.path, text: text.slice(0, 12000), truncated: text.length > 12000 });
  }
  return {
    format, declared_expanded_bytes: directory.expanded,
    parts: directory.entries,
    core_metadata: core ? xmlValues(core) : null,
    application_metadata: app ? xmlValues(app) : null,
    custom_metadata: custom ? xmlValues(custom) : null,
    custom_properties: namedCustomProperties,
    external_relationships: external,
    macro_parts: directory.entries.filter(entry => /(?:vbaProject\.bin|vbaData\.xml)$/i.test(entry.path)).map(entry => entry.path),
    embedded_parts: directory.entries.filter(entry => /\/embeddings\//i.test(entry.path)).map(entry => entry.path),
    text_excerpts: excerpts, excerpt_parts_omitted: Math.max(0, textPaths.length - excerpts.length),
    limitations: "Metadata and links are extracted from the supplied document. Author and timestamp properties are editable claims, not independently verified identity or chronology. Macros are listed but never executed. Encrypted and legacy binary Office formats are unsupported. Excel excerpts include shared strings; formulas and numeric cells are not evaluated.",
  };
}

export async function analyzeDocument(base64: string, filename = ""): Promise<ToolResult> {
  const bytes = decodeDocumentBase64(base64);
  if (!globalThis.crypto?.subtle) throw new Error("This browser lacks the secure Web Crypto API needed to hash document evidence");
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
  let contents: Record<string, unknown>;
  if (latin1(bytes.subarray(0, 8)).startsWith("%PDF-")) contents = inspectPdf(bytes);
  else if (bytes[0] === 0x50 && bytes[1] === 0x4b) contents = await inspectOoxml(bytes);
  else throw new Error("Unsupported document signature. Supply a PDF or unencrypted OOXML .docx, .xlsx or .pptx document.");
  return {
    summary: `${contents.format} document analyzed from ${bytes.length.toLocaleString()} supplied bytes; SHA-256 recorded`,
    details: {
      operation: "supplied_document_analysis", filename: filename.trim().slice(0, 255) || null,
      size_bytes: bytes.length, sha256: hash, ...contents,
      processing: "Local browser analysis; document bytes are not sent to a document provider. Saving results stores the report in your investigation.",
    }, tags: ["document", "forensics", "metadata", "local"],
  };
}

const documentForensics: ToolDefinition = {
  id: "document-forensics",
  name: "Document Forensics",
  description: "Extract real PDF or Office document metadata, links, archive parts and a SHA-256 evidence hash from supplied bytes",
  icon: FileSearch,
  category: "Analysis",
  fields: [
    { key: "filename", label: "Document Filename", placeholder: "document.pdf or document.docx" },
    { key: "file_base64", label: "Document File (PDF / DOCX / XLSX / PPTX)", type: "file", fileEncoding: "base64", accept: ".pdf,.docx,.xlsx,.pptx,.docm,.xlsm,.pptm", maxFileBytes: MAX_DOCUMENT_BYTES, filenameKey: "filename", required: true },
  ],
  process: async inputs => analyzeDocument(inputs.file_base64, inputs.filename),
};

export const marketplaceLocalTools: ToolDefinition[] = [usernamePermutator, emailPermutator, documentForensics, networkForensics];
