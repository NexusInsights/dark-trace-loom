import { supabase } from "@/integrations/supabase/client";

// Levenshtein distance for username similarity
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[m][n];
}

function normalizedSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const al = a.toLowerCase().trim();
  const bl = b.toLowerCase().trim();
  if (al === bl) return 1;
  const dist = levenshtein(al, bl);
  return Math.max(0, 1 - dist / Math.max(al.length, bl.length));
}

// Jaccard similarity for sets
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const v of a) if (b.has(v)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

interface SimilarityResult {
  entityA: string;
  entityB: string;
  similarity: number;
  username: number;
  temporal: number;
  infrastructure: number;
  metadata: number;
  method: string;
}

export async function runBehavioralSimilarity(
  userId: string,
  onProgress?: (step: string) => void
): Promise<{ pairsScored: number; highSimilarity: number }> {
  onProgress?.("Loading entities...");

  const [{ data: entities }, { data: infraLinks }, { data: observations }, { data: timeline }] =
    await Promise.all([
      supabase.from("identity_entities").select("id, entity_type, entity_value, metadata, created_at").eq("user_id", userId),
      supabase.from("infrastructure_links").select("entity_id, infrastructure_type, value").eq("user_id", userId),
      supabase.from("entity_observations").select("entity_id, case_id, source_tool, created_at").eq("user_id", userId),
      supabase.from("entity_timeline").select("entity_id, event_type, event_timestamp").eq("user_id", userId),
    ]);

  if (!entities || entities.length < 2) {
    onProgress?.("Need at least 2 entities");
    return { pairsScored: 0, highSimilarity: 0 };
  }

  onProgress?.(`Analyzing ${entities.length} entities...`);

  // Build lookup maps
  const infraByEntity = new Map<string, Set<string>>();
  for (const il of infraLinks ?? []) {
    if (!infraByEntity.has(il.entity_id)) infraByEntity.set(il.entity_id, new Set());
    infraByEntity.get(il.entity_id)!.add(`${il.infrastructure_type}:${il.value}`);
  }

  const casesByEntity = new Map<string, Set<string>>();
  const toolsByEntity = new Map<string, Set<string>>();
  for (const obs of observations ?? []) {
    if (obs.case_id) {
      if (!casesByEntity.has(obs.entity_id)) casesByEntity.set(obs.entity_id, new Set());
      casesByEntity.get(obs.entity_id)!.add(obs.case_id);
    }
    if (obs.source_tool) {
      if (!toolsByEntity.has(obs.entity_id)) toolsByEntity.set(obs.entity_id, new Set());
      toolsByEntity.get(obs.entity_id)!.add(obs.source_tool);
    }
  }

  // Temporal activity bucketing (hour-of-day distribution)
  const temporalByEntity = new Map<string, number[]>();
  for (const ev of timeline ?? []) {
    if (!temporalByEntity.has(ev.entity_id)) temporalByEntity.set(ev.entity_id, new Array(24).fill(0));
    const hour = new Date(ev.event_timestamp).getUTCHours();
    temporalByEntity.get(ev.entity_id)![hour]++;
  }

  function temporalSimilarity(a: string, b: string): number {
    const ha = temporalByEntity.get(a);
    const hb = temporalByEntity.get(b);
    if (!ha || !hb) return 0;
    const sumA = ha.reduce((s, v) => s + v, 0);
    const sumB = hb.reduce((s, v) => s + v, 0);
    if (sumA === 0 || sumB === 0) return 0;
    // Cosine similarity on hour distributions
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < 24; i++) {
      const na = ha[i] / sumA, nb = hb[i] / sumB;
      dot += na * nb;
      magA += na * na;
      magB += nb * nb;
    }
    return magA > 0 && magB > 0 ? dot / (Math.sqrt(magA) * Math.sqrt(magB)) : 0;
  }

  function metadataSimilarity(a: any, b: any): number {
    const ma = a.metadata as Record<string, any> | null;
    const mb = b.metadata as Record<string, any> | null;
    if (!ma || !mb) return 0;

    let matches = 0, total = 0;
    const allKeys = new Set([...Object.keys(ma), ...Object.keys(mb)]);
    for (const key of allKeys) {
      total++;
      if (ma[key] !== undefined && mb[key] !== undefined) {
        if (String(ma[key]).toLowerCase() === String(mb[key]).toLowerCase()) matches++;
      }
    }
    // Also factor in shared cases and tools
    const caseJaccard = jaccard(casesByEntity.get(a.id) ?? new Set(), casesByEntity.get(b.id) ?? new Set());
    const toolJaccard = jaccard(toolsByEntity.get(a.id) ?? new Set(), toolsByEntity.get(b.id) ?? new Set());
    const metaScore = total > 0 ? matches / total : 0;
    return (metaScore * 0.4 + caseJaccard * 0.3 + toolJaccard * 0.3);
  }

  // Score all pairs (limit to first 200 entities to avoid explosion)
  const limited = entities.slice(0, 200);
  const results: SimilarityResult[] = [];

  onProgress?.(`Computing pairwise similarity for ${limited.length} entities...`);

  for (let i = 0; i < limited.length; i++) {
    for (let j = i + 1; j < limited.length; j++) {
      const a = limited[i], b = limited[j];

      const uSim = normalizedSimilarity(a.entity_value, b.entity_value);
      const tSim = temporalSimilarity(a.id, b.id);
      const iSim = jaccard(infraByEntity.get(a.id) ?? new Set(), infraByEntity.get(b.id) ?? new Set());
      const mSim = metadataSimilarity(a, b);

      // Weighted composite
      const composite = uSim * 0.35 + tSim * 0.2 + iSim * 0.25 + mSim * 0.2;

      // Only store meaningful pairs (> 0.15 threshold)
      if (composite > 0.15) {
        results.push({
          entityA: a.id,
          entityB: b.id,
          similarity: composite,
          username: uSim,
          temporal: tSim,
          infrastructure: iSim,
          metadata: mSim,
          method: "composite",
        });
      }
    }
  }

  if (results.length === 0) {
    onProgress?.("No similar pairs found");
    return { pairsScored: 0, highSimilarity: 0 };
  }

  // Sort by score, keep top 500
  results.sort((a, b) => b.similarity - a.similarity);
  const top = results.slice(0, 500);

  onProgress?.(`Saving ${top.length} similarity scores...`);

  // Clear old scores
  await supabase.from("similarity_scores").delete().eq("user_id", userId);

  // Batch insert
  const batchSize = 50;
  for (let i = 0; i < top.length; i += batchSize) {
    const batch = top.slice(i, i + batchSize).map((r) => ({
      entity_a: r.entityA,
      entity_b: r.entityB,
      similarity_score: Math.round(r.similarity * 1000) / 1000,
      username_similarity: Math.round(r.username * 1000) / 1000,
      temporal_similarity: Math.round(r.temporal * 1000) / 1000,
      infrastructure_similarity: Math.round(r.infrastructure * 1000) / 1000,
      metadata_similarity: Math.round(r.metadata * 1000) / 1000,
      analysis_method: "composite",
      user_id: userId,
      details: {},
    }));
    await supabase.from("similarity_scores").insert(batch);
  }

  const highSim = top.filter((r) => r.similarity >= 0.6).length;
  onProgress?.("Complete!");
  return { pairsScored: top.length, highSimilarity: highSim };
}
