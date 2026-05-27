import { supabase } from "@/integrations/supabase/client";

interface DiscoveryResult {
  casesScanned: number;
  linksFound: number;
}

/**
 * Scans all identity entities and finds those that appear across multiple cases
 * via entity_observations, then creates cross_case_links entries.
 */
export async function runCrossCaseDiscovery(
  userId: string,
  onProgress?: (step: string) => void
): Promise<DiscoveryResult> {
  onProgress?.("Loading entities and observations...");

  const [{ data: entities }, { data: observations }, { data: cases }] = await Promise.all([
    supabase.from("identity_entities").select("*").eq("user_id", userId),
    supabase.from("entity_observations").select("*").eq("user_id", userId),
    supabase.from("cases").select("id, title").eq("owner_id", userId),
  ]);

  if (!entities?.length || !cases?.length) return { casesScanned: 0, linksFound: 0 };

  const caseMap = new Map(cases.map((c) => [c.id, c.title]));

  // Build entity → case_ids mapping from observations + source_case_id
  const entityCases = new Map<string, Set<string>>();
  for (const e of entities) {
    if (!entityCases.has(e.id)) entityCases.set(e.id, new Set());
    if (e.source_case_id) entityCases.get(e.id)!.add(e.source_case_id);
  }
  for (const obs of observations ?? []) {
    if (!entityCases.has(obs.entity_id)) entityCases.set(obs.entity_id, new Set());
    if (obs.case_id) entityCases.get(obs.entity_id)!.add(obs.case_id);
  }

  onProgress?.("Analyzing cross-case overlaps...");

  const links: {
    entity_id: string;
    case_id: string;
    linked_case_id: string;
    link_reason: string;
    user_id: string;
    severity: string;
    metadata: Record<string, unknown>;
  }[] = [];

  for (const [entityId, caseIds] of entityCases.entries()) {
    if (caseIds.size < 2) continue;
    const entity = entities.find((e) => e.id === entityId);
    if (!entity) continue;

    const caseArray = Array.from(caseIds);
    // Create links between all case pairs
    for (let i = 0; i < caseArray.length; i++) {
      for (let j = i + 1; j < caseArray.length; j++) {
        const severity = caseArray.length > 3 ? "critical" : caseArray.length > 2 ? "warning" : "info";
        links.push({
          entity_id: entityId,
          case_id: caseArray[i],
          linked_case_id: caseArray[j],
          link_reason: `Entity "${entity.entity_value}" (${entity.entity_type}) appears in both "${caseMap.get(caseArray[i]) ?? "Unknown"}" and "${caseMap.get(caseArray[j]) ?? "Unknown"}"`,
          user_id: userId,
          severity,
          metadata: {
            entity_type: entity.entity_type,
            entity_value: entity.entity_value,
            total_cases: caseArray.length,
          },
        });
      }
    }
  }

  if (!links.length) {
    onProgress?.("No cross-case links found.");
    return { casesScanned: cases.length, linksFound: 0 };
  }

  onProgress?.(`Saving ${links.length} cross-case links...`);

  // Delete existing links for user to rebuild
  await supabase.from("cross_case_links").delete().eq("user_id", userId);

  let created = 0;
  const batchSize = 50;
  for (let i = 0; i < links.length; i += batchSize) {
    const batch = links.slice(i, i + batchSize);
    const { data, error } = await supabase
      .from("cross_case_links")
      .insert(batch as any)
      .select("id");
    if (!error && data) created += data.length;
  }

  onProgress?.("Complete!");
  return { casesScanned: cases.length, linksFound: created };
}
