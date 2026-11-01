import { canonical, snapshotHashData } from "../../../monitor-worker/src/snapshot-model.js";

export type CoverageState = "found" | "no_match" | "unsupported" | "blocked" | "rate_limited" | "failed" | "stale" | "config_required" | "never_checked";
export type Snapshot = { source: string; fetched_at?: string; coverage?: string; data: Record<string, unknown>; last_verified_optional_sources?: Record<string, unknown> };
export type Coverage = { state: CoverageState; last_attempt: number | null; last_success: number | null; last_verified_state: string | null; stale: boolean; reason?: string | null; partial?: boolean; source_status?: number | null; last_verified_hash?: string | null };
export type MonitorJob = { id: string; kind: string; label: string; params: Record<string, unknown>; enabled: boolean; interval_seconds: number; last_checked?: number; next_due?: number; coverage?: Coverage; budget?: { day: string; approved_daily_limit: number; used: number; remaining: number; requires_licensed_bridge: boolean; notice?: string } };
export type MonitorStatus = { configured: boolean; authorized_page_hosts: string[]; licensed_bridge_configured?: boolean; scheduler?: { next_alarm_at?: number; last_tick?: { completed_at?: number; checked?: number; failed?: number } }; notice?: string };
export type CheckReceipt = { id: string; state: string; observed_at: number; content_hash?: string; source?: string; error?: string; snapshot?: Snapshot; failure_receipt?: { coverage_state?: string; source_status?: number; reason?: string } };
export type VerifiedSnapshot = { id: string; observed_at: number; content_hash: string; snapshot: Snapshot };
export type MonitorHistory = { history: CheckReceipt[]; latest_verified?: Omit<VerifiedSnapshot, "id"> | null; comparison_policy?: string; history_limit?: number; job?: MonitorJob };
export const coverageLabels: Record<CoverageState, string> = { found: "Found", no_match: "No match in checked source", unsupported: "Unsupported", blocked: "Blocked", rate_limited: "Rate limited", failed: "Failed", stale: "Stale", config_required: "Configuration required", never_checked: "Not checked yet" };
const object = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === "object" && !Array.isArray(v));
export function parseMonitorJobs(value: unknown): MonitorJob[] {
  if (!object(value) || !Array.isArray(value.jobs) || value.jobs.length > 100 || value.jobs.some(job => !object(job) || typeof job.id !== "string" || !/^[a-f0-9-]{36}$/i.test(job.id) || typeof job.kind !== "string" || typeof job.label !== "string" || !object(job.params) || typeof job.enabled !== "boolean" || typeof job.interval_seconds !== "number")) throw new Error("Monitoring returned an invalid job list; existing observations were retained.");
  const timestamp = (value: unknown) => value === null || typeof value === "number" && Number.isFinite(value);
  for (const job of value.jobs) {
    if (job.coverage !== undefined && (!object(job.coverage) || !Object.prototype.hasOwnProperty.call(coverageLabels, String(job.coverage.state)) || !timestamp(job.coverage.last_attempt) || !timestamp(job.coverage.last_success) || typeof job.coverage.stale !== "boolean" || (job.coverage.reason != null && typeof job.coverage.reason !== "string"))) throw new Error("Monitoring returned invalid source coverage; no negative finding was established.");
    if (job.budget !== undefined && (!object(job.budget) || typeof job.budget.day !== "string" || typeof job.budget.requires_licensed_bridge !== "boolean" || ["approved_daily_limit", "used", "remaining"].some(key => typeof job.budget[key] !== "number" || !Number.isFinite(job.budget[key]) || job.budget[key] < 0))) throw new Error("The monitoring allowance could not be verified.");
  }
  return value.jobs as MonitorJob[];
}
export function parseMonitorStatus(value: unknown): MonitorStatus {
  if (!object(value) || value.configured !== true || !Array.isArray(value.authorized_page_hosts) || value.authorized_page_hosts.some(host => typeof host !== "string")) throw new Error("The monitoring runtime configuration could not be verified.");
  return value as MonitorStatus;
}
export function parseMonitorHistory(value: unknown): MonitorHistory {
  if (!object(value) || !Array.isArray(value.history) || value.history.length > 100 || value.history.some(row => !object(row) || typeof row.id !== "string" || typeof row.state !== "string" || typeof row.observed_at !== "number")) throw new Error("Monitoring returned invalid history; source evidence was retained.");
  return value as MonitorHistory;
}
export function verifiedSnapshots(history: MonitorHistory): VerifiedSnapshot[] {
  const rows: VerifiedSnapshot[] = history.history.filter(row => row.snapshot && /^(baseline|changed|unchanged)$/.test(row.state) && /^[a-f0-9]{64}$/i.test(row.content_hash || "")) as VerifiedSnapshot[];
  if (history.latest_verified?.snapshot) rows.push({ ...history.latest_verified, id: "latest-verified" });
  const seen = new Set<string>();
  return rows.filter(row => object(row.snapshot?.data) && typeof row.snapshot.source === "string" && /^[a-f0-9]{64}$/i.test(row.content_hash)).sort((a, b) => b.observed_at - a.observed_at || (a.id === "latest-verified" ? -1 : 1)).filter(row => {
    if (seen.has(row.content_hash)) return false; seen.add(row.content_hash); return true;
  });
}
export async function verifySnapshot(kind: string, record: VerifiedSnapshot): Promise<boolean> {
  if (!globalThis.crypto?.subtle) throw new Error("This browser cannot verify SHA-256 here. Use HTTPS in a supported browser.");
  const value = canonical(snapshotHashData(kind, record.snapshot));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const actual = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  return actual === record.content_hash.toLowerCase();
}
export function snapshotDiff(kind: string, before: Snapshot, after: Snapshot) {
  const oldData = snapshotHashData(kind, before), newData = snapshotHashData(kind, after);
  const changes: { field: string; before: string; after: string }[] = [];
  function visit(a: unknown, b: unknown, field: string, depth: number) {
    if (canonical(a) === canonical(b) || changes.length >= 64) return;
    if (object(a) && object(b) && depth < 8) {
      for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) visit(a[key], b[key], field ? `${field}.${key}` : key, depth + 1);
    } else changes.push({ field: field || "source data", before: canonical(a) ?? "(absent)", after: canonical(b) ?? "(absent)" });
  }
  visit(oldData, newData, "", 0);
  return changes;
}
export function authorizedSource(urlValue: string, status: MonitorStatus | null): string {
  let url: URL; try { url = new URL(urlValue); } catch { throw new Error("Enter a valid public HTTPS source URL."); }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) throw new Error("Use HTTPS without embedded credentials or a custom port.");
  if (!status?.authorized_page_hosts.map(host => host.trim().toLowerCase()).includes(url.hostname.toLowerCase())) throw new Error("This hostname is not in the runtime's approved source list. No monitoring request was created.");
  if ([...url.searchParams.keys()].some(key => /token|secret|password|api.?key|auth/i.test(key))) throw new Error("Remove credential parameters from the source URL.");
  return url.href;
}
export function monitorDate(seconds?: number | null): string { return typeof seconds === "number" && Number.isFinite(seconds) ? new Date(seconds * 1000).toLocaleString() : "Not recorded"; }
