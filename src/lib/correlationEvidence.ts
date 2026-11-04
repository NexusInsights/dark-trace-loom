import type { CorrelationType } from "./correlationEngine";
import { validateLookup } from "./publicProfileEvidence";
import { evidenceDate, publicEvidenceUrl } from "./identityEvidence";

export interface CorrelationObservation {
  type: CorrelationType;
  value: string;
  sourceUrl: string;
  retrievedAt: string;
}
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";
const sourceUrl = publicEvidenceUrl;
const timestamp = (value: unknown): string => evidenceDate(value) ? value : "";
const excluded = (record: Record<string, unknown>): boolean => {
  const status = text(record.status).toLowerCase();
  const review = object(record.review ?? record.profile_association_review);
  return record.demo === true || record.resolution_excluded === true
    || !!status && !["success", "partial", "completed", "complete", "observed", "found"].includes(status)
    || /^(input|auto_expansion)$|generat|permut|candidat|infer|synthetic|guess|variation/i.test(text(record.source))
    || review.decision === "rejected";
};

/** Literal sourced observations create leads only, never a person/account association. */
export function extractCorrelationObservations(raw: string): CorrelationObservation[] {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  const envelope = object(parsed);
  const details = Object.keys(object(envelope.details)).length ? object(envelope.details) : envelope;
  if (excluded(envelope) || excluded(details)) return [];
  const observations: CorrelationObservation[] = [];
  function add(type: CorrelationType, value: unknown, source: string, retrieved: string) {
    const normalized = type === "domain" ? text(value).toLowerCase() : text(value);
    if (!normalized || !source || !retrieved) return;
    if (type === "username" && !/^[a-z0-9_.-]{1,100}$/i.test(normalized)) return;
    if (type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return;
    if (type === "phone" && !/^\+?[\d\s().-]{10,30}$/.test(normalized)) return;
    if (type === "ip" && (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(normalized) || normalized.split(".").some(part => +part > 255))) return;
    if (type === "domain" && !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(normalized)) return;
    observations.push({ type, value: normalized, sourceUrl: source, retrievedAt: retrieved });
  }
  // Positive checks must bind the exact account URL, username and source URL.
  // Inputs, provider URLs, biographies and negative checks are never regex-mined.
  let profiles: unknown[] = [];
  if (Array.isArray(details.profiles)) {
    try { profiles = validateLookup(details).profiles; } catch { return []; }
  }
  for (const value of profiles) {
    const profile = object(value);
    if (excluded(profile)) continue;
    const profileUrl = sourceUrl(profile.profileUrl);
    const source = sourceUrl(profile.sourceUrl);
    const retrieved = timestamp(profile.retrievedAt);
    const found = (Array.isArray(details.checks) ? details.checks : []).some(value => {
      const check = object(value), checkedProfile = object(check.profile);
      return check.status === "found" && sourceUrl(check.sourceUrl) === source
        && sourceUrl(checkedProfile.profileUrl) === profileUrl
        && text(checkedProfile.username) === text(profile.username);
    });
    if (!profileUrl || !found) continue;
    add("username", profile.username, source, retrieved);
    add("email", profile.email, source, retrieved);
    add("phone", profile.phone, source, retrieved);
  }
  for (const value of Array.isArray(details.observations) ? details.observations : []) {
    const observation = object(value);
    if (excluded(observation) || observation.evidence_kind !== "source_observation" || observation.status !== "observed") continue;
    const type = text(observation.identifier_type) as CorrelationType;
    if (!["username", "email", "domain", "ip", "phone"].includes(type)) continue;
    add(type, observation.value, sourceUrl(observation.source_url), timestamp(observation.retrieved_at));
  }
  const seen = new Set<string>();
  return observations.filter(observation => {
    const key = `${observation.type}:${observation.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

interface SavedLead {
  source_artifact_id: string | null; target_artifact_id: string | null;
  source_type: string; target_type: string; source_value: string; target_value: string;
  relationship_type: string; confidence: number;
}
/** Revalidate saved computed leads against current source records without deleting legacy data. */
export function visibleCorrelationLeads<T extends SavedLead>(leads: T[], artifacts: { id: string; data: string | null }[]): T[] {
  const observed = new Map(artifacts.map(artifact => [artifact.id, new Set(extractCorrelationObservations(artifact.data ?? "").map(observation => `${observation.type}:${observation.value}`))]));
  return leads.filter(lead => lead.confidence === 0 && lead.relationship_type === `shared_${lead.source_type}_lead`
    && lead.source_type === lead.target_type && lead.source_value === lead.target_value
    && observed.get(lead.source_artifact_id ?? "")?.has(`${lead.source_type}:${lead.source_value}`)
    && observed.get(lead.target_artifact_id ?? "")?.has(`${lead.target_type}:${lead.target_value}`));
}
