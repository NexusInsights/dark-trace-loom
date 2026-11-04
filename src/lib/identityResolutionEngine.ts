import { checkedDatabase } from "@/lib/checkedDatabase";
import { supabase } from "@/integrations/supabase/client";
import { evidenceObject, supportedProfileAssociations } from "./identityEvidence";
import type { SavedIdentityRecord } from "./identityEvidence";
import type { Json } from "@/integrations/supabase/types";
import { loadIdentitySourceRecords } from "./loadIdentityEvidence";

export type IdentityType = "username" | "email" | "domain" | "ip" | "phone" | "social_profile";

/** An observed account is not automatically an identity belonging to the investigated person. */
export async function runIdentityResolution(userId: string, onProgress?: (step: string) => void): Promise<{ entitiesResolved: number; linksCreated: number }> {
  if (!userId.trim()) throw new Error("Sign in before resolving identities.");
  onProgress?.("Loading retained account observations and analyst association reviews...");
  const records = await loadIdentitySourceRecords(userId);
  const associations = supportedProfileAssociations(records);
  const entities = await readAll(() => supabase.from("identity_entities").select("id,entity_type,entity_value,source_tool,metadata").eq("user_id", userId).order("id"));
  const active = new Set(associations.map(row => row.evidence.profile_url));
  // Preserve original records; quarantine unsupported historical resolver derivatives.
  for (const entity of entities) {
    if (!/^(?:persona_identifier:|tool_result:|pdl_lookup:|profile_association:)/.test(entity.source_tool ?? "") || active.has(entity.entity_value)) continue;
    const metadata = evidenceObject(entity.metadata);
    if (metadata.resolution_excluded === true) continue;
    await checkedDatabase(supabase.from("identity_entities").update({ metadata: {
      ...metadata, resolution_excluded: true, resolution_exclusion_reason: "No current source-bound analyst-supported person association",
    } as Json }).eq("id", entity.id).eq("user_id", userId));
  }
  const observations = await readAll(() => supabase.from("entity_observations").select("entity_id,case_id,source_tool,observed_value").eq("user_id", userId).order("id"));
  let entitiesResolved = 0;
  onProgress?.(`Saving ${associations.length} analyst-supported account associations...`);
  for (const association of associations) {
    const evidence = association.evidence;
    const prior = entities.find(row => row.entity_type === "social_profile" && row.entity_value === evidence.profile_url);
    const { data } = await checkedDatabase(supabase.from("identity_entities").upsert({
      user_id: userId, entity_type: "social_profile", entity_value: evidence.profile_url,
      // Required legacy numeric field: zero means unassessed, never a probability.
      confidence_score: 0, source_case_id: association.caseId, source_tool: `profile_association:${evidence.review_id}`,
      metadata: { ...evidenceObject(prior?.metadata), resolution_excluded: false, resolution_exclusion_reason: null, identity_evidence: evidence } as unknown as Json,
    }, { onConflict: "user_id,entity_type,entity_value" }).select("id, entity_type, entity_value"));
    const entity = data?.[0];
    if (!entity) throw new Error("The supported account association was not saved.");
    entitiesResolved++;
    const source = `profile_association:${evidence.review_id}`;
    if (!observations.some(row => row.entity_id === entity.id && row.source_tool === source && row.observed_value === evidence.profile_url)) {
      await checkedDatabase(supabase.from("entity_observations").insert({ user_id: userId, entity_id: entity.id, case_id: association.caseId, source_tool: source, observed_value: evidence.profile_url }));
    }
  }
  onProgress?.("Account associations updated. Inputs and same-handle accounts remain leads; no ownership links were inferred.");
  return { entitiesResolved, linksCreated: 0 };
}
async function readAll<T>(query: () => { range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }> }): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data } = await checkedDatabase(query().range(offset, offset + 499));
    rows.push(...(data ?? []));
    if (!data || data.length < 500) return rows;
  }
}
