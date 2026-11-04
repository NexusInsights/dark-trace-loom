import { checkedDatabase } from "@/lib/checkedDatabase";
import { supabase } from "@/integrations/supabase/client";
import { extractCorrelationObservations } from "./correlationEvidence";

export type CorrelationType = "username" | "email" | "domain" | "ip" | "phone";
interface Identifier { type: CorrelationType; value: string; artifactId: string; caseId: string; }
interface CorrelationLead {
  source_type: string; source_value: string; source_case_id: string; source_artifact_id: string | null;
  target_type: string; target_value: string; target_case_id: string; target_artifact_id: string | null;
  relationship_type: string; confidence: number;
}
const keyFor = (lead: CorrelationLead): string => [lead.relationship_type, ...[
  `${lead.source_case_id}:${lead.source_artifact_id}:${lead.source_type}:${lead.source_value}`,
  `${lead.target_case_id}:${lead.target_artifact_id}:${lead.target_type}:${lead.target_value}`,
].sort()].join("|");

/** Find literal shared source observations. These are unverified leads, not identity findings. */
export async function runCorrelationEngine(userId: string, onProgress?: (step: string) => void): Promise<{ correlationsFound: number; identifiersScanned: number }> {
  if (!userId.trim()) throw new Error("Sign in before comparing observations");
  onProgress?.("Loading accessible cases...");
  const { data: cases } = await checkedDatabase(supabase.from("cases").select("id, title").order("created_at", { ascending: false }));
  if (!cases || cases.length < 2) return { correlationsFound: 0, identifiersScanned: 0 };
  const { data: artifacts } = await checkedDatabase(supabase.from("artifacts").select("id, case_id, data, artifact_type").in("case_id", cases.map(record => record.id)));
  const identifiers: Identifier[] = [];
  for (const artifact of artifacts ?? []) {
    if (artifact.data) identifiers.push(...extractCorrelationObservations(artifact.data).map(observation => ({ type: observation.type, value: observation.value, artifactId: artifact.id, caseId: artifact.case_id })));
  }
  const leads: CorrelationLead[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < identifiers.length; i++) for (let j = i + 1; j < identifiers.length; j++) {
    const source = identifiers[i], target = identifiers[j];
    if (source.caseId === target.caseId || source.type !== target.type || source.value !== target.value) continue;
    const lead: CorrelationLead = {
      source_type: source.type, source_value: source.value, source_case_id: source.caseId, source_artifact_id: source.artifactId,
      target_type: target.type, target_value: target.value, target_case_id: target.caseId, target_artifact_id: target.artifactId,
      relationship_type: `shared_${source.type}_lead`,
      // Required legacy database field; zero means unassessed, never a probability.
      confidence: 0,
    };
    const key = keyFor(lead);
    if (!seen.has(key)) { seen.add(key); leads.push(lead); }
  }
  if (leads.length) {
    const { data: existing } = await checkedDatabase(supabase.from("cross_case_correlations").select("*").eq("user_id", userId));
    const existingKeys = new Set((existing ?? []).map(record => keyFor(record)));
    const pending = leads.filter(lead => !existingKeys.has(keyFor(lead)));
    onProgress?.(`Saving ${pending.length} new unverified leads; existing records are retained...`);
    for (let i = 0; i < pending.length; i += 50) await checkedDatabase(supabase.from("cross_case_correlations").insert(pending.slice(i, i + 50).map(lead => ({ ...lead, user_id: userId }))));
  }
  onProgress?.("Comparison complete. Shared observations do not establish shared ownership.");
  return { correlationsFound: leads.length, identifiersScanned: identifiers.length };
}
