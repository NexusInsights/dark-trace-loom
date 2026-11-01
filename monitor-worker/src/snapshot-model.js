// Shared by the durable runtime and browser verification. Sorting collections is
// intentional: source ordering and polling time do not establish a change.
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).sort().join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

export function snapshotHashData(kind, snapshot) {
  if (kind !== "cve") return snapshot.data;
  const retained = snapshot.last_verified_optional_sources || {};
  return {
    total_results: snapshot.data.total_results,
    vulnerabilities: snapshot.data.vulnerabilities,
    epss: retained.epss?.records || null,
    cisa_kev: retained.cisa_kev?.records || null,
  };
}

export function snapshotFinding(snapshot) {
  const data = snapshot?.data || {};
  if (data.exists === false) return "no_match";
  for (const key of ["profiles", "items", "messages", "records", "vulnerabilities", "aircraft"]) {
    if (Array.isArray(data[key]) && data[key].length === 0) return "no_match";
  }
  return "found";
}

export function failureReceipt(error, message) {
  const status = Number.isInteger(error?.sourceStatus) ? error.sourceStatus : Number.isInteger(error?.status) ? error.status : null;
  const state = error?.coverageState === "unsupported" || status === 501 || status === 422 ? "unsupported"
    : status === 424 ? "config_required" : status === 401 || status === 403 ? "blocked"
    : status === 429 ? "rate_limited" : "failed";
  return { receipt_kind: "source_failure", coverage_state: state, source_status: Number.isInteger(error?.sourceStatus) ? error.sourceStatus : null, reason: message };
}

export function coverageForJob(row, now) {
  let snapshot = null, receipt = null, invalidSnapshot = false;
  try { snapshot = row.last_snapshot_json ? JSON.parse(row.last_snapshot_json) : null; } catch { invalidSnapshot = true; }
  try { receipt = row.latest_receipt_json ? JSON.parse(row.latest_receipt_json) : null; } catch { /* Older failure receipts may have no metadata. */ }
  const lastSuccess = Number.isFinite(row.last_success) ? row.last_success : null;
  const staleAfter = Math.max(900, row.interval_seconds * 2);
  const stale = lastSuccess !== null && now - lastSuccess > staleAfter;
  const verifiedState = snapshot?.data ? snapshotFinding(snapshot) : null;
  const failed = row.latest_state === "failed" || row.latest_state === "allowance_deferred";
  const state = invalidSnapshot ? "failed" : failed ? receipt?.coverage_state || (row.latest_state === "allowance_deferred" ? "rate_limited" : "failed")
    : stale ? "stale" : verifiedState || "never_checked";
  return {
    state, last_attempt: row.last_checked ?? null, last_success: lastSuccess,
    last_verified_state: verifiedState, stale, stale_after_seconds: staleAfter,
    reason: invalidSnapshot ? "Stored source metadata could not be read; no coverage claim was made." : failed ? receipt?.reason || row.last_error || "The last attempt did not establish source coverage."
      : stale ? "The retained source observation is older than two intervals (at least 15 minutes)."
      : snapshot?.data?.source_errors?.length ? "Some contributing sources were unavailable; inspect the coverage notice and retained-source timestamps." : null,
    partial: Boolean(snapshot?.data?.source_errors?.length), source_status: failed ? receipt?.source_status ?? null : null,
    last_verified_hash: row.last_hash || null,
    notice: "A no-match applies only to the bounded, successfully checked source. An unavailable source is not a negative finding. Last attempt may be blocked before a provider request.",
  };
}
