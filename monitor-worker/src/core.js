import { canonical } from "./snapshot-model.js";
export { canonical } from "./snapshot-model.js";
export class HttpError extends Error { constructor(message, status = 400, details = {}) { super(message); this.status = status; if (Number.isInteger(details.sourceStatus)) this.sourceStatus = details.sourceStatus; if (details.coverageState === "unsupported") this.coverageState = "unsupported"; } }
export const LIMITS = { jobs_per_user: 100, job_params_chars: 5000, body_bytes: 16384, response_bytes: 2 * 1024 * 1024, snapshot_chars: 250000, source_timeout_ms: 18000, lease_seconds: 90 };
export const MONITOR_USER_AGENT = "InsightNexus/1.0 (contact: travis@tjksecurity.com)";
export const nowSeconds = () => Math.floor(Date.now() / 1000);
export const timestamp = seconds => new Date(seconds * 1000).toISOString();
export function plain(value) { return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null; }
export function text(value, name, max = 200, optional = false) {
  if (optional && (value === undefined || value === "")) return "";
  if (typeof value !== "string" || !value.trim() || value.trim().length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new HttpError(`${name} must contain 1–${max} printable characters`);
  return value.trim();
}
export function number(value, name, min, max, fallback) {
  const result = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isFinite(result) || result < min || result > max) throw new HttpError(`${name} must be between ${min} and ${max}`);
  return result;
}
export function integer(value, name, min, max, fallback) {
  const result = number(value, name, min, max, fallback);
  if (!Number.isInteger(result)) throw new HttpError(`${name} must be an integer`);
  return result;
}
export function json(body, status = 200, headers = {}) { return Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers } }); }
export async function readJson(request) {
  const type = request.headers.get("content-type") || "";
  if (!type.includes("application/json")) throw new HttpError("Use application/json", 415);
  const raw = await readBody(request, LIMITS.body_bytes);
  let value; try { value = JSON.parse(raw); } catch { throw new HttpError("Request JSON is invalid"); }
  if (!plain(value)) throw new HttpError("Request must be a JSON object");
  return value;
}
export async function readBody(message, maxBytes) {
  if (Number(message.headers.get("content-length")) > maxBytes) throw new HttpError("Body exceeds its configured size limit", 413);
  const reader = message.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder(); let bytes = 0; let content = "";
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => undefined); }, 10000);
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > maxBytes) { await reader.cancel(); throw new HttpError("Body exceeds its configured size limit", 413); }
      content += decoder.decode(part.value, { stream: true });
    }
    if (timedOut) throw new HttpError("Body read timed out", 408);
    return content + decoder.decode();
  } finally { clearTimeout(timer); reader.releaseLock(); }
}
export async function sourceRequest(url, init = {}, fetcher = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIMITS.source_timeout_ms);
  try {
    const headers = new Headers(init.headers);
    if (!headers.has("User-Agent")) headers.set("User-Agent", MONITOR_USER_AGENT);
    const response = await fetcher(url, { ...init, headers, redirect: "manual", signal: controller.signal });
    const body = await readBody(response, LIMITS.response_bytes);
    return { response, body };
  } catch (error) {
    if (controller.signal.aborted) throw new HttpError("External source timed out; no automatic provider retry was made", 502);
    throw error;
  } finally { clearTimeout(timer); }
}
export async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
export function boundedSnapshot(snapshot) {
  if (!plain(snapshot) || !plain(snapshot.data) || typeof snapshot.source !== "string") throw new HttpError("Source did not return a valid sourced snapshot", 502);
  const serialized = JSON.stringify(snapshot);
  if (serialized.length > LIMITS.snapshot_chars) throw new HttpError("Source snapshot exceeded its storage limit; narrow the monitor", 413);
  return serialized;
}
export function changeSummary(previous, current) {
  const before = plain(previous?.data) || {}; const after = plain(current.data) || {};
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(key => canonical(before[key]) !== canonical(after[key]));
  return { changed_fields: keys.slice(0, 30), previous_hash_available: Boolean(previous), note: "Change is based on sourced content, not the polling timestamp. Missing coverage is reported separately." };
}
export function backoff(interval, failures) { return Math.min(86400, Math.max(interval, 300) * 2 ** Math.min(failures - 1, 8)); }
export function decodeEntities(value) {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&#(x[\da-f]+|\d+);/gi, (_, entity) => { const code = entity[0].toLowerCase() === "x" ? parseInt(entity.slice(1), 16) : Number(entity); return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ""; }).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}
export function visibleText(value) { return decodeEntities(value.replace(/<script\b[\s\S]*?<\/script>/gi, "").replace(/<style\b[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim(); }
