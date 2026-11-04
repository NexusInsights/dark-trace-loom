import { jsonValue } from "@/lib/jsonValue";
import { checkedDatabase } from "@/lib/checkedDatabase";
import { supabase } from "@/integrations/supabase/client";
import { evidenceObject, filterCurrentIdentityEntities } from "./identityEvidence";
import { loadIdentitySourceRecords } from "./loadIdentityEvidence";

interface ScoreResult {
  entitiesScored: number;
}

export async function computeEntityScores(
  userId: string,
  onProgress?: (step: string) => void
): Promise<ScoreResult> {
  onProgress?.("Loading entities...");

  const { data: savedEntities } = await checkedDatabase(supabase
    .from("identity_entities")
    .select("id, entity_type, entity_value, metadata")
    .eq("user_id", userId));

  const entities = filterCurrentIdentityEntities(savedEntities ?? [], await loadIdentitySourceRecords(userId));
  if (!entities.length) return { entitiesScored: 0 };

  onProgress?.("Analyzing links...");

  const { data: links } = await checkedDatabase(supabase
    .from("identity_entity_links")
    .select("source_entity_id, target_entity_id, relationship_type")
    .eq("user_id", userId));

  onProgress?.("Analyzing observations...");

  const { data: observations } = await checkedDatabase(supabase
    .from("entity_observations")
    .select("entity_id, case_id, source_tool")
    .eq("user_id", userId));

  onProgress?.("Analyzing social graph...");

  const { data: socialEdges } = await checkedDatabase(supabase
    .from("social_graph_edges")
    .select("source_entity_id, target_entity_id, relationship_type")
    .eq("user_id", userId));

  // Build metrics per entity
  const linkCount = new Map<string, number>();
  const admitted = new Set(entities.map(entity => entity.id));
  for (const l of links ?? []) {
    if (l.relationship_type !== "analyst_supported_association" || !admitted.has(l.source_entity_id) || !admitted.has(l.target_entity_id)) continue;
    linkCount.set(l.source_entity_id, (linkCount.get(l.source_entity_id) ?? 0) + 1);
    linkCount.set(l.target_entity_id, (linkCount.get(l.target_entity_id) ?? 0) + 1);
  }

  const caseSets = new Map<string, Set<string>>();
  const reviewSources = new Map(entities.map(entity => [entity.id, `profile_association:${evidenceObject(evidenceObject(entity.metadata).identity_evidence).review_id}`]));
  for (const o of observations ?? []) {
    if (!o.case_id || !admitted.has(o.entity_id) || o.source_tool !== reviewSources.get(o.entity_id)) continue;
    if (!caseSets.has(o.entity_id)) caseSets.set(o.entity_id, new Set());
    caseSets.get(o.entity_id)!.add(o.case_id);
  }

  const infraCount = new Map<string, number>();
  const relDensity = new Map<string, number>();
  for (const e of socialEdges ?? []) {
    if (e.relationship_type !== "observed_profile_link" || !admitted.has(e.source_entity_id) || !admitted.has(e.target_entity_id)) continue;
    relDensity.set(e.source_entity_id, (relDensity.get(e.source_entity_id) ?? 0) + 1);
    relDensity.set(e.target_entity_id, (relDensity.get(e.target_entity_id) ?? 0) + 1);
  }

  onProgress?.(`Scoring ${entities.length} entities...`);

  const scores: {
    entity_id: string;
    user_id: string;
    score: number;
    score_reasons: { factor: string; value: number; contribution: number }[];
    linked_identifiers: number;
    case_appearances: number;
    infrastructure_overlap: number;
    relationship_density: number;
  }[] = [];

  for (const entity of entities) {
    const linked = linkCount.get(entity.id) ?? 0;
    const cases = caseSets.get(entity.id)?.size ?? 0;
    const infra = infraCount.get(entity.id) ?? 0;
    const rels = relDensity.get(entity.id) ?? 0;

    // Weighted scoring: each factor contributes to a 0-100 scale
    const evidence = evidenceObject(evidenceObject(entity.metadata).identity_evidence);
    const reasons: { factor: string; value: number; contribution: number; review_id?: unknown; account_id?: unknown; lookup_result_id?: unknown; supporting_source_url?: unknown }[] = [{ factor: "Source-reviewed connectivity heuristic", value: 0, contribution: 0, review_id: evidence.review_id, account_id: evidence.account_id, lookup_result_id: evidence.lookup_result_id, supporting_source_url: evidence.supporting_source_url }];

    const linkedScore = Math.min(linked * 8, 25);
    reasons.push({ factor: "Linked identifiers", value: linked, contribution: linkedScore });

    const caseScore = Math.min(cases * 12, 30);
    reasons.push({ factor: "Case appearances", value: cases, contribution: caseScore });

    const infraScore = Math.min(infra * 10, 25);
    reasons.push({ factor: "Infrastructure overlap", value: infra, contribution: infraScore });

    const relScore = Math.min(rels * 5, 20);
    reasons.push({ factor: "Relationship density", value: rels, contribution: relScore });

    const totalScore = Math.min(linkedScore + caseScore + infraScore + relScore, 100);

    scores.push({
      entity_id: entity.id,
      user_id: userId,
      score: totalScore,
      score_reasons: reasons,
      linked_identifiers: linked,
      case_appearances: cases,
      infrastructure_overlap: infra,
      relationship_density: rels,
    });
  }

  onProgress?.("Saving scores...");

  const batchSize = 50;
  for (let i = 0; i < scores.length; i += batchSize) {
    const batch = scores.slice(i, i + batchSize);
    await checkedDatabase(supabase
      .from("entity_scores")
      .upsert(batch.map(row => ({...row, score_reasons: jsonValue(row.score_reasons)})), { onConflict: "entity_id,user_id" }));
  }

  onProgress?.("Complete!");
  return { entitiesScored: scores.length };
}
