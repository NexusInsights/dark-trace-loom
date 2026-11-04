import { evidenceObject, isResolvedIdentityEntity } from "./identityEvidence";

export interface ReviewedEntity { id: string; entity_type: string; entity_value: string; metadata?: unknown; }
export const REVIEWED_GROUP_PREFIX = "Analyst-supported accounts: ";
export const SOURCE_COMPARISON_METHOD = "reviewed_source_context_v1";

export function associationEvidence(entity: ReviewedEntity) {
  return evidenceObject(evidenceObject(entity.metadata).identity_evidence);
}

/** Group explicit analyst decisions about one dossier; never union shared strings. */
export function reviewedAccountGroups(entities: ReviewedEntity[]) {
  const groups = new Map<string, ReviewedEntity[]>();
  for (const entity of entities.filter(isResolvedIdentityEntity)) {
    const evidence = associationEvidence(entity), personaId = String(evidence.persona_id);
    const group = groups.get(personaId) ?? [];
    if (!group.some(member => associationEvidence(member).account_id === evidence.account_id)) group.push(entity);
    groups.set(personaId, group);
  }
  return [...groups].filter(([, members]) => members.length >= 2).map(([personaId, members]) => ({ personaId, members }));
}

export function reviewedMembershipReason(entity: ReviewedEntity) {
  const evidence = associationEvidence(entity);
  return JSON.stringify({
    classification: "analyst_supported_group", persona_id: evidence.persona_id, account_id: evidence.account_id,
    review_id: evidence.review_id, lookup_result_id: evidence.lookup_result_id,
    source_url: evidence.source_url, supporting_source_url: evidence.supporting_source_url,
    rationale: "An analyst supported this observed account's association with this dossier. Group membership does not independently establish a person's identity.",
  });
}

export function isReviewedMembership(member: { entity_id: string; join_reason?: string | null }, entities: ReviewedEntity[]) {
  const entity = entities.find(item => item.id === member.entity_id);
  if (!entity || !isResolvedIdentityEntity(entity)) return false;
  let reason: Record<string, unknown>;
  try { reason = evidenceObject(JSON.parse(member.join_reason || "")); } catch { return false; }
  const evidence = associationEvidence(entity);
  return reason.classification === "analyst_supported_group" &&
    ["persona_id", "account_id", "review_id", "lookup_result_id", "source_url", "supporting_source_url"].every(key => reason[key] === evidence[key]);
}

export function visibleReviewedClusters<T extends { id: string; cluster_label: string }>(
  clusters: T[], members: { cluster_id: string; entity_id: string; join_reason?: string | null }[], entities: ReviewedEntity[],
) {
  return clusters.filter(cluster => {
    const admitted = members.filter(member => member.cluster_id === cluster.id && isReviewedMembership(member, entities));
    const ids = new Set(admitted.map(member => associationEvidence(entities.find(entity => entity.id === member.entity_id)!).account_id));
    const people = new Set(admitted.map(member => associationEvidence(entities.find(entity => entity.id === member.entity_id)!).persona_id));
    return ids.size >= 2 && people.size === 1 && cluster.cluster_label === REVIEWED_GROUP_PREFIX + [...people][0];
  });
}

/** These are auditable source-context comparisons, not identity/risk probabilities. */
export function sourceContextComparisons(entities: ReviewedEntity[], userId: string) {
  const eligible = entities.filter(isResolvedIdentityEntity).sort((a, b) => a.id.localeCompare(b.id));
  const admitted = eligible.slice(0, 200);
  const rows = [];
  for (let i = 0; i < admitted.length; i++) for (let j = i + 1; j < admitted.length; j++) {
    const a = admitted[i], b = admitted[j], ea = associationEvidence(a), eb = associationEvidence(b);
    const signals: string[] = [];
    if (ea.persona_id === eb.persona_id) signals.push("An analyst associated both observed accounts with the same dossier; this is not independent ownership verification.");
    if (ea.supporting_source_url === eb.supporting_source_url) signals.push("Both reviews cite the same supporting source. Count it as one source, not independent corroboration.");
    if (ea.account_id === eb.account_id) signals.push("Both records reference the same stable platform account ID; this does not establish the real-world operator.");
    if (!signals.length) continue;
    const observedAt = [String(ea.reviewed_at), String(eb.reviewed_at)].sort().at(-1)!;
    rows.push({
      id: `source-context:${a.id}:${b.id}`, user_id: userId, entity_a: a.id, entity_b: b.id,
      analysis_method: SOURCE_COMPARISON_METHOD, similarity_score: 0,
      username_similarity: null, temporal_similarity: null, infrastructure_similarity: null, metadata_similarity: null,
      created_at: observedAt, updated_at: observedAt,
      details: { classification: "research_lead", excluded_from_identity: true, excluded_from_reports: true,
        signals, entity_a_review_id: String(ea.review_id), entity_b_review_id: String(eb.review_id),
        source_urls: [...new Set([String(ea.source_url), String(eb.source_url)])],
        supporting_source_urls: [...new Set([String(ea.supporting_source_url), String(eb.supporting_source_url)])],
        comparison_scope: `Compared at most 200 of ${eligible.length} admitted account records; display is limited to 500 source-context pairs.`,
        limitation: "Descriptive comparison of saved analyst reviews; no inference from matching names, handles, employers, domains, IPs, case membership or activity hours.",
      },
    });
    if (rows.length === 500) return rows;
  }
  return rows;
}
