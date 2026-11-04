import { validateProfileSearchResult } from "./publicProfiles";
/** Person associations require a retained source observation and an explicit analyst review. */
export interface IdentityEvidence {
  classification: "analyst_supported_association";
  persona_id: string; account_id: string; profile_url: string;
  lookup_result_id: string; review_id: string; source_url: string;
  retrieved_at: string; supporting_source_url: string; reviewed_at: string;
}
export function evidenceObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function publicEvidenceUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value), host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (url.protocol !== "https:" || url.username || url.password || !host.includes(".") ||
      /(?:^|\.)(?:localhost|local|internal|test|invalid|example)$/.test(host) || host.includes(":") ||
      /^(?:0|10|127)\.|^169\.254\.|^192\.168\.|^172\.(?:1[6-9]|2\d|3[01])\./.test(host)) return "";
    return url.href;
  } catch { return ""; }
}
export function evidenceDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
}
export function isResolvedIdentityEntity(entity: { metadata?: unknown; entity_type?: unknown; entity_value?: unknown }): boolean {
  const metadata = evidenceObject(entity.metadata), evidence = evidenceObject(metadata.identity_evidence);
  return entity.entity_type === "social_profile" && !!publicEvidenceUrl(entity.entity_value) && publicEvidenceUrl(entity.entity_value) === publicEvidenceUrl(evidence.profile_url) && metadata.resolution_excluded !== true && evidence.classification === "analyst_supported_association" &&
    ["persona_id", "account_id", "lookup_result_id", "review_id"].every(key => typeof evidence[key] === "string" && !!String(evidence[key]).trim()) &&
    !!publicEvidenceUrl(evidence.profile_url) && !!publicEvidenceUrl(evidence.source_url) && !!publicEvidenceUrl(evidence.supporting_source_url) && evidenceDate(evidence.retrieved_at) && evidenceDate(evidence.reviewed_at);
}
export interface SavedIdentityRecord { id: string; tool_name: string; result_data: unknown; status?: string | null; created_at: string; case_id?: string | null; }
export function filterCurrentIdentityEntities<T extends { metadata?: unknown; entity_type?: unknown; entity_value?: unknown }>(entities: T[], records: SavedIdentityRecord[]): T[] {
  const supported = supportedProfileAssociations(records);
  return entities.filter(entity => {
    if (!isResolvedIdentityEntity(entity)) return false;
    const evidence = evidenceObject(evidenceObject(entity.metadata).identity_evidence);
    return supported.some(row => Object.entries(row.evidence).every(([key, value]) => evidence[key] === value));
  });
}
/** The caller must first admit the entity against the current owned review ledger. */
export function isCurrentConnectivityScore(score: { entity_id?: unknown; score_reasons?: unknown }, entity: { id?: unknown; metadata?: unknown; entity_type?: unknown; entity_value?: unknown }): boolean {
  if (score.entity_id !== entity.id || !isResolvedIdentityEntity(entity) || !Array.isArray(score.score_reasons)) return false;
  const evidence = evidenceObject(evidenceObject(entity.metadata).identity_evidence);
  return score.score_reasons.some(raw => {
    const reason = evidenceObject(raw);
    return reason.factor === "Source-reviewed connectivity heuristic" && ["review_id", "account_id", "lookup_result_id", "supporting_source_url"].every(key => reason[key] === evidence[key]);
  });
}
/** Decisions bind stable accounts to retained observations, never a coincidentally equal handle. */
export function supportedProfileAssociations(records: SavedIdentityRecord[]): { evidence: IdentityEvidence; caseId: string | null }[] {
  const latest = new Map<string, SavedIdentityRecord>();
  for (const record of [...records].sort((a, b) => (a.created_at || "").localeCompare(b.created_at || "") || a.id.localeCompare(b.id))) {
    if (record.tool_name !== "profile-association-review" || record.status !== "success") continue;
    const review = evidenceObject(record.result_data);
    if (typeof review.persona_id !== "string" || typeof review.account_id !== "string" || !["supported", "rejected", "unreviewed"].includes(String(review.decision))) continue;
    latest.set(JSON.stringify([review.persona_id, review.account_id]), record);
  }
  const rows: { evidence: IdentityEvidence; caseId: string | null }[] = [];
  for (const record of latest.values()) {
    const review = evidenceObject(record.result_data);
    if (review.decision !== "supported" || typeof review.reason !== "string" || review.reason.trim().length < 10 || !publicEvidenceUrl(review.supporting_source_url) || !evidenceDate(review.reviewed_at)) continue;
    const lookup = records.find(row => row.id === review.lookup_result_id && row.tool_name === "public-profile-search" && ["success", "partial"].includes(row.status || ""));
    if (!lookup) continue;
    const data = evidenceObject(lookup.result_data), result = Array.isArray(data.profiles) ? data : evidenceObject(data.details);
    if (data.persona_id !== review.persona_id) continue;
    try { validateProfileSearchResult(result); } catch { continue; }
    const profile = (result.profiles as unknown[]).map(evidenceObject).find(row => row.accountId === review.account_id && publicEvidenceUrl(row.profileUrl) === publicEvidenceUrl(review.profile_url));
    if (!profile || profile.existence !== "found" || typeof profile.platformId !== "string" || !profile.platformId.trim() || !publicEvidenceUrl(profile.profileUrl) || !publicEvidenceUrl(profile.sourceUrl) || !evidenceDate(profile.retrievedAt)) continue;
    if (Date.parse(review.reviewed_at) < Date.parse(profile.retrievedAt)) continue;
    rows.push({ evidence: { classification: "analyst_supported_association", persona_id: String(review.persona_id), account_id: String(review.account_id), profile_url: publicEvidenceUrl(profile.profileUrl), lookup_result_id: lookup.id, review_id: record.id, source_url: publicEvidenceUrl(profile.sourceUrl), retrieved_at: profile.retrievedAt, supporting_source_url: publicEvidenceUrl(review.supporting_source_url), reviewed_at: review.reviewed_at }, caseId: lookup.case_id ?? null });
  }
  // Conflicting analyst associations stay in the review ledger, not in a single
  // globally resolved account row that would silently pick one person's identity.
  const peopleByAccount = new Map<string, Set<string>>();
  for (const row of rows) {
    const people = peopleByAccount.get(row.evidence.account_id) ?? new Set<string>();
    people.add(row.evidence.persona_id); peopleByAccount.set(row.evidence.account_id, people);
  }
  return rows.filter(row => peopleByAccount.get(row.evidence.account_id)?.size === 1);
}
