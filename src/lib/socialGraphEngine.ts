import { checkedDatabase } from "@/lib/checkedDatabase";
import { supabase } from "@/integrations/supabase/client";
import { filterCurrentIdentityEntities } from "./identityEvidence";
import { loadIdentitySourceRecords } from "./loadIdentityEvidence";
import type { Json } from "@/integrations/supabase/types";

interface MiningResult { edgesCreated: number; entitiesAnalyzed: number; }
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Build reviewed person/account associations only; text similarity is never ownership evidence. */
export async function runSocialGraphMining(userId: string, onProgress?: (step: string) => void): Promise<MiningResult> {
  if (!userId.trim()) throw new Error("Sign in before reviewing associations");
  onProgress?.("Loading reviewed identity evidence...");
  const { data } = await checkedDatabase(supabase.from("identity_entities").select("*").eq("user_id", userId));
  const entities = filterCurrentIdentityEntities(data ?? [], await loadIdentitySourceRecords(userId));
  if (!entities.length) return { edgesCreated: 0, entitiesAnalyzed: 0 };
  const edges = [];
  for (let i = 0; i < entities.length; i++) for (let j = i + 1; j < entities.length; j++) {
    const source = object(object(entities[i].metadata).identity_evidence);
    const target = object(object(entities[j].metadata).identity_evidence);
    if (source.persona_id !== target.persona_id) continue;
    const [sourceId, targetId] = [entities[i].id, entities[j].id].sort();
    edges.push({
      user_id: userId,
      source_entity_id: sourceId,
      target_entity_id: targetId,
      relationship_type: "analyst_supported_association",
      // Legacy non-null column. The UI shows the review basis, never a made-up probability.
      confidence_score: 0,
      source_tool: "profile-association-review",
      evidence: "Both account observations have source-backed analyst reviews for the same persona. This records the review decision, not certainty of identity.",
      metadata: { assessment: "analyst_supported_association", confidence_assessed: false, persona_id: source.persona_id, source_review: source, target_review: target } as Json,
    });
  }
  let edgesCreated = 0;
  for (let i = 0; i < edges.length; i += 50) {
    const { data: saved } = await checkedDatabase(supabase.from("social_graph_edges").upsert(edges.slice(i, i + 50), { onConflict: "user_id,source_entity_id,target_entity_id,relationship_type" }).select("id"));
    edgesCreated += saved?.length ?? 0;
  }
  onProgress?.("Reviewed associations saved. Original legacy records have been retained.");
  return { edgesCreated, entitiesAnalyzed: entities.length };
}
